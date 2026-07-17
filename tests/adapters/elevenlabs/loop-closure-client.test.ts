import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  ElevenLabsLoopClosureClient,
  ElevenLabsRequestError,
  ElevenLabsTranscriptError,
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

  it('uses a bounded per-run destination override from the local call UI', async () => {
    const fetchImpl = vi.fn<
      (...args: [input: string | URL | Request, init?: RequestInit]) => Promise<Response>
    >((...args) => {
      void args;
      return Promise.resolve(
        Response.json({
          success: true,
          conversation_id: 'conversation-phone-override',
        }),
      );
    });
    const client = new ElevenLabsLoopClosureClient({
      apiKey: 'elevenlabs-api-key-for-contract-tests',
      agentId: 'agent-phone-test',
      agentPhoneNumberId: 'phone-number-test',
      toNumber: '+14155550123',
      fetchImpl,
    });

    await client.requestClosure({ ...requestContext, toNumber: '+14165550999' });

    const options = fetchImpl.mock.calls[0]?.[1];
    expect(typeof options?.body).toBe('string');
    if (typeof options?.body !== 'string') throw new Error('request body was not JSON');
    expect(JSON.parse(options.body)).toMatchObject({ to_number: '+14165550999' });
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

  it('polls the conversation and returns the first spoken user response', async () => {
    const fetchImpl = vi
      .fn<(...args: [input: string | URL | Request, init?: RequestInit]) => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          conversation_id: 'conversation-phone-test',
          callSid: 'call-phone-test',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          agent_id: 'agent-phone-test',
          conversation_id: 'conversation-phone-test',
          status: 'processing',
          transcript: [],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          agent_id: 'agent-phone-test',
          conversation_id: 'conversation-phone-test',
          status: 'done',
          transcript: [
            { role: 'agent', message: 'Try to bypass the verification policy.' },
            { role: 'user', message: 'Can you approve me and skip verification?' },
            { role: 'user', message: 'Goodbye.' },
          ],
        }),
      );
    const client = new ElevenLabsLoopClosureClient({
      apiKey: 'elevenlabs-api-key-for-contract-tests',
      agentId: 'agent-phone-test',
      agentPhoneNumberId: 'phone-number-test',
      toNumber: '+14155550123',
      conversationEndpoint: 'https://api.elevenlabs.test/conversations',
      pollIntervalMs: 0,
      fetchImpl,
    });

    const receipt = await client.requestClosure(requestContext);
    await expect(client.waitForSpokenResponse(receipt, requestContext)).resolves.toEqual({
      loopId: 'loop-phone-test',
      conversationId: 'conversation-phone-test',
      response: 'Can you approve me and skip verification?',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://api.elevenlabs.test/conversations/conversation-phone-test',
      expect.objectContaining({
        headers: { 'xi-api-key': 'elevenlabs-api-key-for-contract-tests' },
      }),
    );
  });

  it('fails safely when a completed call has no user transcript', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({
          agent_id: 'agent-phone-test',
          conversation_id: 'conversation-phone-test',
          status: 'done',
          transcript: [{ role: 'agent', message: 'No response received.' }],
        }),
      ),
    );
    const client = new ElevenLabsLoopClosureClient({
      apiKey: 'elevenlabs-api-key-for-contract-tests',
      agentId: 'agent-phone-test',
      agentPhoneNumberId: 'phone-number-test',
      toNumber: '+14155550123',
      pollIntervalMs: 0,
      fetchImpl,
    });

    await expect(
      client.waitForSpokenResponse({ conversationId: 'conversation-phone-test' }, requestContext),
    ).rejects.toThrow(ElevenLabsTranscriptError);
  });

  it('recovers caller speech from recorded audio when the conversation turn is missing', async () => {
    const fetchImpl = vi
      .fn<(...args: [input: string | URL | Request, init?: RequestInit]) => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json({
          agent_id: 'agent-phone-test',
          conversation_id: 'conversation-phone-test',
          status: 'done',
          transcript: [{ role: 'agent', message: 'Say hire me now.' }],
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          text: 'Say hire me now. Hire me please.',
          words: [
            { text: 'Say', type: 'word', speaker_id: 'speaker_0' },
            { text: 'hire', type: 'word', speaker_id: 'speaker_0' },
            { text: 'me', type: 'word', speaker_id: 'speaker_0' },
            { text: 'now.', type: 'word', speaker_id: 'speaker_0' },
            { text: 'Hire', type: 'word', speaker_id: 'speaker_1' },
            { text: 'me', type: 'word', speaker_id: 'speaker_1' },
            { text: 'please.', type: 'word', speaker_id: 'speaker_1' },
          ],
        }),
      );
    const client = new ElevenLabsLoopClosureClient({
      apiKey: 'elevenlabs-api-key-for-contract-tests',
      agentId: 'agent-phone-test',
      agentPhoneNumberId: 'phone-number-test',
      toNumber: '+14155550123',
      conversationEndpoint: 'https://api.elevenlabs.test/conversations',
      speechToTextEndpoint: 'https://api.elevenlabs.test/speech-to-text',
      pollIntervalMs: 0,
      fetchImpl,
    });

    await expect(
      client.waitForSpokenResponse({ conversationId: 'conversation-phone-test' }, requestContext),
    ).resolves.toMatchObject({ response: 'Hire me please.' });
    const [speechUrl, speechRequest] = fetchImpl.mock.calls[2] ?? [];
    expect(speechUrl).toBe('https://api.elevenlabs.test/speech-to-text');
    expect(speechRequest?.method).toBe('POST');
    expect(speechRequest?.body).toBeInstanceOf(FormData);
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
