import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { SpokenLoopClosure } from '../../loop/closure.js';

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

const dynamicValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const transcriptEntrySchema = z
  .object({
    role: z.string(),
    message: z.string().optional(),
  })
  .passthrough();
const webhookEventSchema = z
  .object({
    type: z.string().trim().min(1).max(128),
    event_timestamp: z.number().int().nonnegative().optional(),
    data: z
      .object({
        agent_id: z.string().optional(),
        conversation_id: z.string().trim().min(1).max(256).optional(),
        failure_reason: z.string().trim().min(1).max(512).optional(),
        transcript: z.array(transcriptEntrySchema).max(1_000).optional(),
        conversation_initiation_client_data: z
          .object({
            dynamic_variables: z.record(z.string(), dynamicValueSchema).optional(),
          })
          .passthrough()
          .nullish(),
      })
      .passthrough(),
  })
  .passthrough();

export type ElevenLabsWebhookEvent = z.infer<typeof webhookEventSchema>;

export class ElevenLabsWebhookSignatureError extends Error {
  public constructor() {
    super('The ElevenLabs webhook signature is invalid.');
    this.name = 'ElevenLabsWebhookSignatureError';
  }
}

export class ElevenLabsWebhookPayloadError extends Error {
  public constructor() {
    super('The ElevenLabs webhook payload is invalid.');
    this.name = 'ElevenLabsWebhookPayloadError';
  }
}

export function verifyAndParseElevenLabsWebhook(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
  now: () => number = Date.now,
): ElevenLabsWebhookEvent {
  const signature = parseSignature(signatureHeader);
  const ageSeconds = Math.abs(Math.floor(now() / 1_000) - signature.timestamp);
  if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) throw new ElevenLabsWebhookSignatureError();

  const expected = createHmac('sha256', secret)
    .update(`${signature.timestamp}.${rawBody}`)
    .digest('hex');
  const actualBuffer = Buffer.from(signature.digest, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new ElevenLabsWebhookSignatureError();
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    throw new ElevenLabsWebhookPayloadError();
  }
  const parsed = webhookEventSchema.safeParse(body);
  if (!parsed.success) throw new ElevenLabsWebhookPayloadError();
  return parsed.data;
}

export function extractLoopClosure(event: ElevenLabsWebhookEvent): SpokenLoopClosure | null {
  if (event.type !== 'post_call_transcription') return null;
  const loopId = event.data.conversation_initiation_client_data?.dynamic_variables?.loop_id;
  const conversationId = event.data.conversation_id;
  const response = event.data.transcript
    ?.find((entry) => entry.role === 'user' && entry.message?.trim())
    ?.message?.trim();
  if (typeof loopId !== 'string' || conversationId === undefined || response === undefined) {
    return null;
  }
  return { loopId, conversationId, response: response.slice(0, 4_000) };
}

function parseSignature(signatureHeader: string | undefined): {
  timestamp: number;
  digest: string;
} {
  if (signatureHeader === undefined) throw new ElevenLabsWebhookSignatureError();
  const fields = new Map(
    signatureHeader.split(',').map((part) => {
      const separator = part.indexOf('=');
      return separator < 1
        ? ['', '']
        : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }),
  );
  const timestamp = Number(fields.get('t'));
  const digest = fields.get('v0');
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !/^[a-f0-9]{64}$/i.test(digest ?? '')) {
    throw new ElevenLabsWebhookSignatureError();
  }
  return { timestamp, digest: digest as string };
}
