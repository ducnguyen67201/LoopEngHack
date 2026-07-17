import { z } from 'zod';

import type {
  LoopClosureContext,
  LoopClosurePort,
  LoopClosureReceipt,
} from '../../loop/closure.js';

const DEFAULT_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/twilio/outbound-call';

const outboundCallResponseSchema = z
  .object({
    success: z.literal(true),
    conversation_id: z.string().trim().min(1).max(256),
    callSid: z.string().trim().min(1).max(256).nullish(),
  })
  .passthrough();

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ElevenLabsLoopClosureClientOptions {
  readonly apiKey: string;
  readonly agentId: string;
  readonly agentPhoneNumberId: string;
  readonly toNumber: string;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
}

export class ElevenLabsRequestError extends Error {
  public constructor(message = 'ElevenLabs could not start the loop-closure call.') {
    super(message);
    this.name = 'ElevenLabsRequestError';
  }
}

export class ElevenLabsLoopClosureClient implements LoopClosurePort {
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  public constructor(private readonly options: ElevenLabsLoopClosureClientOptions) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
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
          to_number: this.options.toNumber,
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
}
