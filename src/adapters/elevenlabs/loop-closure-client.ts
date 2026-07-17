import { z } from 'zod';

import type {
  LoopClosureContext,
  LoopClosurePort,
  LoopClosureReceipt,
  SpokenLoopClosure,
} from '../../loop/closure.js';

const DEFAULT_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/twilio/outbound-call';
const DEFAULT_CONVERSATION_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/conversations';

const outboundCallResponseSchema = z
  .object({
    success: z.literal(true),
    conversation_id: z.string().trim().min(1).max(256),
    callSid: z.string().trim().min(1).max(256).nullish(),
  })
  .passthrough();

const conversationResponseSchema = z
  .object({
    agent_id: z.string().trim().min(1).max(256),
    conversation_id: z.string().trim().min(1).max(256),
    status: z.enum(['initiated', 'in-progress', 'processing', 'done', 'failed']),
    transcript: z
      .array(
        z
          .object({
            role: z.string(),
            message: z.string().optional(),
          })
          .passthrough(),
      )
      .max(1_000)
      .default([]),
  })
  .passthrough();

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ElevenLabsLoopClosureClientOptions {
  readonly apiKey: string;
  readonly agentId: string;
  readonly agentPhoneNumberId: string;
  readonly toNumber: string;
  readonly endpoint?: string;
  readonly conversationEndpoint?: string;
  readonly timeoutMs?: number;
  readonly conversationTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly fetchImpl?: FetchLike;
}

export class ElevenLabsRequestError extends Error {
  public constructor(message = 'ElevenLabs could not start the loop-closure call.') {
    super(message);
    this.name = 'ElevenLabsRequestError';
  }
}

export class ElevenLabsTranscriptError extends Error {
  public constructor(message = 'ElevenLabs could not retrieve the spoken loop response.') {
    super(message);
    this.name = 'ElevenLabsTranscriptError';
  }
}

export class ElevenLabsLoopClosureClient implements LoopClosurePort {
  private readonly conversationEndpoint: string;
  private readonly conversationTimeoutMs: number;
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  public constructor(private readonly options: ElevenLabsLoopClosureClientOptions) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.conversationEndpoint = options.conversationEndpoint ?? DEFAULT_CONVERSATION_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.conversationTimeoutMs = options.conversationTimeoutMs ?? 300_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_500;
  }

  public async requestClosure(context: LoopClosureContext): Promise<LoopClosureReceipt> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.options.apiKey,
        },
        body: JSON.stringify({
          agent_id: this.options.agentId,
          agent_phone_number_id: this.options.agentPhoneNumberId,
          to_number: context.toNumber ?? this.options.toNumber,
          call_recording_enabled: false,
          conversation_initiation_client_data: {
            dynamic_variables: {
              loop_id: context.loopId,
              loop_status: context.resultStatus,
              readiness_score: context.readinessScore,
              loop_reason: context.reason,
              episode_count: context.episodeCount,
              hostile_evaluations: context.hostileEvaluations,
              legitimate_controls: context.legitimateControls,
              attack_families_covered: context.attackFamiliesCovered,
            },
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ElevenLabsRequestError();
    }

    if (!response.ok) throw new ElevenLabsRequestError();
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ElevenLabsRequestError();
    }
    const parsed = outboundCallResponseSchema.safeParse(body);
    if (!parsed.success) throw new ElevenLabsRequestError();

    return {
      conversationId: parsed.data.conversation_id,
      ...(parsed.data.callSid === null || parsed.data.callSid === undefined
        ? {}
        : { callSid: parsed.data.callSid }),
    };
  }

  public async waitForSpokenResponse(
    receipt: LoopClosureReceipt,
    context: LoopClosureContext,
  ): Promise<SpokenLoopClosure> {
    const deadline = Date.now() + this.conversationTimeoutMs;
    const endpoint = `${this.conversationEndpoint.replace(/\/$/, '')}/${encodeURIComponent(receipt.conversationId)}`;

    while (Date.now() <= deadline) {
      let response: Response;
      try {
        response = await this.fetchImpl(endpoint, {
          headers: { 'xi-api-key': this.options.apiKey },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        await this.waitBeforeRetry(deadline);
        continue;
      }

      if (response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new ElevenLabsTranscriptError();
        }
        const parsed = conversationResponseSchema.safeParse(body);
        if (!parsed.success) throw new ElevenLabsTranscriptError();
        const conversation = parsed.data;
        if (
          conversation.agent_id !== this.options.agentId ||
          conversation.conversation_id !== receipt.conversationId
        ) {
          throw new ElevenLabsTranscriptError();
        }
        if (conversation.status === 'failed') throw new ElevenLabsTranscriptError();
        if (conversation.status === 'done') {
          const spoken = conversation.transcript
            .find((entry) => entry.role === 'user' && entry.message?.trim())
            ?.message?.trim();
          if (spoken === undefined) throw new ElevenLabsTranscriptError();
          return {
            loopId: context.loopId,
            conversationId: receipt.conversationId,
            response: spoken.slice(0, 4_000),
          };
        }
      } else if (response.status === 401 || response.status === 403) {
        throw new ElevenLabsTranscriptError();
      }

      await this.waitBeforeRetry(deadline);
    }

    throw new ElevenLabsTranscriptError(
      'The ElevenLabs call timed out before a transcript was ready.',
    );
  }

  private async waitBeforeRetry(deadline: number): Promise<void> {
    if (Date.now() > deadline) return;
    await new Promise<void>((resolve) => setTimeout(resolve, this.pollIntervalMs));
  }
}
