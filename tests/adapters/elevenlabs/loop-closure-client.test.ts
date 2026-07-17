import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  ElevenLabsLoopClosureClient,
  ElevenLabsRequestError,
} from '../../../src/adapters/elevenlabs/loop-closure-client.js';
import {
  ElevenLabsWebhookSignatureError,
  extractLoopClosure,
  verifyAndParseElevenLabsWebhook,
} from '../../../src/adapters/elevenlabs/webhook.js';

const requestContext = {
  loopId: 'loop-phone-test',
  resultStatus: 'complete' as const,
  readinessScore: 93,
  reason: 'readiness and safety gates passed',
  episodeCount: 4,
  hostileEvaluations: 4,
  legitimateControls: 4,
  attackFamiliesCovered: 4,
};

describe('ElevenLabsLoopClosureClient', () => {
  it('starts one outbound call with compact loop context', async () => {
    const fetchImpl = vi.fn(
      (...args: [input: string | URL | Request, init?: RequestInit]): Promise<Response> => {
        void args;
        return Promise.resolve(
          Response.json({
            success: true,
            message: 'Call initiated',
            conversation_id: 'conversation-phone-test',
            callSid: 'call-phone-test',
          }),
        );
      },
    );
    const client = new ElevenLabsLoopClosureClient({
      apiKey: 'elevenlabs-api-key-for-contract-tests',
      agentId: 'agent-phone-test',
      agentPhoneNumberId: 'phone-number-test',
      toNumber: '+14155550123',
      fetchImpl,
    });

    await expect(client.requestClosure(requestContext)).resolves.toEqual({
      conversationId: 'conversation-phone-test',
      callSid: 'call-phone-test',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.elevenlabs.io/v1/convai/twilio/outbound-call');
    expect(options).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': 'elevenlabs-api-key-for-contract-tests',
      },
    });
    expect(typeof options?.body).toBe('string');
    if (typeof options?.body !== 'string') throw new Error('request body was not JSON');
    expect(JSON.parse(options.body)).toEqual({
      agent_id: 'agent-phone-test',
      agent_phone_number_id: 'phone-number-test',
      to_number: '+14155550123',
      call_recording_enabled: false,
      conversation_initiation_client_data: {
        dynamic_variables: {
          loop_id: 'loop-phone-test',
          loop_status: 'complete',
          readiness_score: 93,
          loop_reason: 'readiness and safety gates passed',
          episode_count: 4,
          hostile_evaluations: 4,
          legitimate_controls: 4,
          attack_families_covered: 4,
        },
      },
    });
  });

  it('fails with a safe error that does not expose provider response details', async () => {
    const fetchImpl = vi.fn(
      (...args: [input: string | URL | Request, init?: RequestInit]): Promise<Response> => {
        void args;
        return Promise.resolve(
          Response.json({ detail: 'provider-secret-detail' }, { status: 401 }),
        );
      },
    );
    const client = new ElevenLabsLoopClosureClient({
      apiKey: 'elevenlabs-api-key-for-contract-tests',
      agentId: 'agent-phone-test',
      agentPhoneNumberId: 'phone-number-test',
      toNumber: '+14155550123',
      fetchImpl,
    });

    await expect(client.requestClosure(requestContext)).rejects.toThrow(ElevenLabsRequestError);
    await expect(client.requestClosure(requestContext)).rejects.not.toThrow(
      /provider-secret-detail/,
    );
  });
});

describe('ElevenLabs post-call webhook', () => {
  it('verifies the HMAC signature and extracts the last spoken user response', () => {
    const secret = 'elevenlabs-webhook-secret-for-tests';
    const timestamp = 1_752_796_800;
    const rawBody = JSON.stringify({
      type: 'post_call_transcription',
      event_timestamp: timestamp,
      data: {
        agent_id: 'agent-phone-test',
        conversation_id: 'conversation-phone-test',
        status: 'done',
        transcript: [
          { role: 'agent', message: 'What should I record?' },
          { role: 'user', message: 'Ship it, but keep an eye on false positives.' },
          { role: 'agent', message: 'Understood.' },
          { role: 'user', message: 'Thanks, goodbye.' },
        ],
        conversation_initiation_client_data: {
          dynamic_variables: { loop_id: 'loop-phone-test' },
        },
      },
    });
    const digest = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

    const event = verifyAndParseElevenLabsWebhook(
      rawBody,
      `t=${timestamp},v0=${digest}`,
      secret,
      () => timestamp * 1_000,
    );

    expect(extractLoopClosure(event)).toEqual({
      loopId: 'loop-phone-test',
      conversationId: 'conversation-phone-test',
      response: 'Ship it, but keep an eye on false positives.',
    });
  });

  it('rejects an invalid or stale webhook signature', () => {
    const rawBody = JSON.stringify({ type: 'post_call_transcription', data: {} });

    expect(() =>
      verifyAndParseElevenLabsWebhook(
        rawBody,
        't=1752796800,v0=bad-signature',
        'elevenlabs-webhook-secret-for-tests',
        () => 1_752_796_800_000,
      ),
    ).toThrow(ElevenLabsWebhookSignatureError);

    const staleTimestamp = 1_752_796_000;
    const secret = 'elevenlabs-webhook-secret-for-tests';
    const digest = createHmac('sha256', secret)
      .update(`${staleTimestamp}.${rawBody}`)
      .digest('hex');
    expect(() =>
      verifyAndParseElevenLabsWebhook(
        rawBody,
        `t=${staleTimestamp},v0=${digest}`,
        secret,
        () => 1_752_796_800_000,
      ),
    ).toThrow(ElevenLabsWebhookSignatureError);
  });
});
