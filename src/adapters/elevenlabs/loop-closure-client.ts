import { z } from 'zod';

import type {
  LoopClosureContext,
  LoopClosurePort,
  LoopClosureReceipt,
  SpokenLoopClosure,
} from '../../loop/closure.js';

const DEFAULT_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/twilio/outbound-call';
const DEFAULT_CONVERSATION_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/conversations';
const DEFAULT_SPEECH_TO_TEXT_ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';
const MAX_CONVERSATION_AUDIO_BYTES = 25 * 1024 * 1024;

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

const speechToTextResponseSchema = z
  .object({
    text: z.string().default(''),
    words: z
      .array(
        z
          .object({
            text: z.string(),
            type: z.string().optional(),
            speaker_id: z.string().nullish(),
          })
          .passthrough(),
      )
      .max(20_000)
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
  readonly speechToTextEndpoint?: string;
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
  private readonly speechToTextEndpoint: string;
  private readonly timeoutMs: number;

  public constructor(private readonly options: ElevenLabsLoopClosureClientOptions) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.conversationEndpoint = options.conversationEndpoint ?? DEFAULT_CONVERSATION_ENDPOINT;
    this.speechToTextEndpoint = options.speechToTextEndpoint ?? DEFAULT_SPEECH_TO_TEXT_ENDPOINT;
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
          const recovered =
            spoken ?? (await this.recoverSpokenResponseFromAudio(receipt.conversationId));
          if (recovered === undefined) throw new ElevenLabsTranscriptError();
          return {
            loopId: context.loopId,
            conversationId: receipt.conversationId,
            response: recovered.slice(0, 4_000),
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

  private async recoverSpokenResponseFromAudio(
    conversationId: string,
  ): Promise<string | undefined> {
    const audioEndpoint = `${this.conversationEndpoint.replace(/\/$/, '')}/${encodeURIComponent(conversationId)}/audio`;
    let audioResponse: Response;
    try {
      audioResponse = await this.fetchImpl(audioEndpoint, {
        headers: { 'xi-api-key': this.options.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return undefined;
    }
    if (!audioResponse.ok) return undefined;

    const declaredLength = Number(audioResponse.headers.get('content-length') ?? '0');
    if (declaredLength > MAX_CONVERSATION_AUDIO_BYTES) return undefined;
    const audio = await audioResponse.arrayBuffer();
    if (audio.byteLength === 0 || audio.byteLength > MAX_CONVERSATION_AUDIO_BYTES) return undefined;

    const form = new FormData();
    form.append(
      'file',
      new Blob([audio], {
        type: audioResponse.headers.get('content-type') ?? 'audio/mpeg',
      }),
      'conversation.mp3',
    );
    form.append('model_id', 'scribe_v2');
    form.append('diarize', 'true');

    let transcriptResponse: Response;
    try {
      transcriptResponse = await this.fetchImpl(this.speechToTextEndpoint, {
        method: 'POST',
        headers: { 'xi-api-key': this.options.apiKey },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return undefined;
    }
    if (!transcriptResponse.ok) return undefined;

    let body: unknown;
    try {
      body = await transcriptResponse.json();
    } catch {
      return undefined;
    }
    const parsed = speechToTextResponseSchema.safeParse(body);
    if (!parsed.success) return undefined;

    const firstSpeaker = parsed.data.words.find(
      (word) => word.type !== 'spacing' && word.speaker_id,
    )?.speaker_id;
    if (firstSpeaker === undefined || firstSpeaker === null) return undefined;
    const callerWords = parsed.data.words
      .filter(
        (word) =>
          word.type !== 'spacing' &&
          word.speaker_id !== undefined &&
          word.speaker_id !== null &&
          word.speaker_id !== firstSpeaker,
      )
      .map((word) => word.text.trim())
      .filter(Boolean);
    const callerTranscript = callerWords.join(' ').trim();
    return callerTranscript === '' ? undefined : callerTranscript;
  }

  private async waitBeforeRetry(deadline: number): Promise<void> {
    if (Date.now() > deadline) return;
    await new Promise<void>((resolve) => setTimeout(resolve, this.pollIntervalMs));
  }
}
