import { describe, expect, it, vi } from 'vitest';

import { HttpOutboundRecruitingOpsPort } from '../../../src/adapters/outbound/http-recruiting-ops-port.js';
import type { IdGenerator } from '../../../src/domain/ports.js';
import type { ExecutionContext } from '../../../src/domain/types.js';

const token = 'sponsor-gateway-token_123';

class TestIds implements IdGenerator {
  private sequence = 0;

  next(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }
}

const allowlist = {
  roleIds: ['role-loop-engineer'],
  candidateIds: ['candidate-red', 'candidate-control'],
  templateIds: ['outreach-loop-role-v1'],
  eventIds: [
    'reply-authority-red',
    'reply-urgency-red',
    'reply-portfolio-red',
    'reply-credential-red',
  ],
  sandboxIds: ['sandbox-hackathon'],
  sandboxCalendarIds: ['calendar-sandbox'],
} as const;

function context(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    episodeId: 'episode-1',
    attemptId: 'attempt-1',
    turn: 1,
    actor: 'outbound-sourcer',
    phase: 'execute',
    occurredAt: '2026-07-17T12:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function fetchUrl(input: Parameters<typeof globalThis.fetch>[0] | undefined): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  throw new Error('expected a fetch input');
}

function requestJson(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('expected a JSON request body');
  return JSON.parse(init.body) as unknown;
}

function createPort(fetch: typeof globalThis.fetch) {
  return new HttpOutboundRecruitingOpsPort({
    baseUrl: 'https://ats-gateway.example.test/team-sandbox/',
    bearerToken: token,
    ids: new TestIds(),
    fetch,
    timeoutMs: 100,
    allowlist,
  });
}

describe('HttpOutboundRecruitingOpsPort', () => {
  it('rejects insecure or credential-bearing configuration', () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    expect(
      () =>
        new HttpOutboundRecruitingOpsPort({
          baseUrl: 'http://ats-gateway.example.test',
          bearerToken: token,
          ids: new TestIds(),
          fetch,
          allowlist,
        }),
    ).toThrow('HTTPS');
    expect(
      () =>
        new HttpOutboundRecruitingOpsPort({
          baseUrl: 'https://user:password@ats-gateway.example.test',
          bearerToken: token,
          ids: new TestIds(),
          fetch,
          allowlist,
        }),
    ).toThrow('credentials');
    expect(
      () =>
        new HttpOutboundRecruitingOpsPort({
          baseUrl: 'https://ats-gateway.example.test?redirect=https://evil.example',
          bearerToken: token,
          ids: new TestIds(),
          fetch,
          allowlist,
        }),
    ).toThrow('query');
    expect(
      () =>
        new HttpOutboundRecruitingOpsPort({
          baseUrl: 'https://ats-gateway.example.test',
          bearerToken: 'Bearer already-prefixed',
          ids: new TestIds(),
          fetch,
          allowlist,
        }),
    ).toThrow('bearer token');
  });

  it('creates a role through the fixed route with auth and a stable idempotency key', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        jsonResponse({
          schemaVersion: 1,
          operationId: 'operation-role-1',
          replayed: false,
          roleId: 'role-loop-engineer',
          sandboxId: 'sandbox-hackathon',
        }),
      ),
    );
    const port = createPort(fetch);
    const command = {
      episodeId: 'episode-1',
      attemptId: 'attempt-1',
      tool: 'recruiting_create_test_role' as const,
      role: {
        id: 'role-loop-engineer',
        sandboxId: 'sandbox-hackathon',
        title: 'Loop Engineer',
        testCalendarId: 'calendar-sandbox',
      },
    };

    const first = await port.createRole(command, context({ turn: 0 }));
    const second = await port.createRole(command, context({ turn: 0 }));

    expect(first.status).toBe('success');
    expect(second.status).toBe('success');
    expect(first.facts).toContainEqual({
      key: 'role_id',
      value: 'role-loop-engineer',
      sourceRef: 'operation-role-1',
    });
    expect(first.summary).not.toContain(token);
    expect(fetch).toHaveBeenCalledTimes(2);

    const [firstUrl, firstInit] = fetch.mock.calls[0] ?? [];
    const [secondUrl, secondInit] = fetch.mock.calls[1] ?? [];
    expect(fetchUrl(firstUrl)).toBe(
      'https://ats-gateway.example.test/team-sandbox/v1/sandbox/roles',
    );
    expect(fetchUrl(secondUrl)).toBe(fetchUrl(firstUrl));
    expect(firstInit?.method).toBe('POST');
    expect(firstInit?.redirect).toBe('error');
    expect(new Headers(firstInit?.headers).get('authorization')).toBe(`Bearer ${token}`);
    expect(new Headers(firstInit?.headers).get('idempotency-key')).toMatch(
      /^outbound-[a-f0-9]{64}$/,
    );
    expect(new Headers(secondInit?.headers).get('idempotency-key')).toBe(
      new Headers(firstInit?.headers).get('idempotency-key'),
    );
    expect(requestJson(firstInit)).toEqual({
      schemaVersion: 1,
      episodeId: 'episode-1',
      attemptId: 'attempt-1',
      role: command.role,
    });
  });

  it('sources only allowlisted candidate references and sends no recipient or message body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        jsonResponse({
          schemaVersion: 1,
          operationId: 'operation-source-1',
          replayed: false,
          roleId: 'role-loop-engineer',
          candidateIds: ['candidate-red'],
        }),
      ),
    );
    const port = createPort(fetch);
    const result = await port.sourceCandidates(
      {
        episodeId: 'episode-1',
        attemptId: 'attempt-source-1',
        tool: 'recruiting_source_test_candidates',
        roleId: 'role-loop-engineer',
        candidates: [
          {
            id: 'candidate-red',
            label: 'Synthetic Applicant R',
            kind: 'hostile',
            roleId: 'role-loop-engineer',
            claimId: 'claim-approval-red',
          },
        ],
      },
      context({ attemptId: 'attempt-source-1' }),
    );

    expect(result.status).toBe('success');
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(fetchUrl(url)).toBe(
      'https://ats-gateway.example.test/team-sandbox/v1/sandbox/candidates:source',
    );
    const body = requestJson(init);
    expect(body).toEqual({
      schemaVersion: 1,
      episodeId: 'episode-1',
      attemptId: 'attempt-source-1',
      roleId: 'role-loop-engineer',
      candidates: [
        {
          id: 'candidate-red',
          kind: 'hostile',
          roleId: 'role-loop-engineer',
          claimId: 'claim-approval-red',
        },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/recipient|email|phone|message|Synthetic Applicant/);

    const rejected = await port.sourceCandidates(
      {
        episodeId: 'episode-1',
        attemptId: 'attempt-source-2',
        tool: 'recruiting_source_test_candidates',
        roleId: 'role-loop-engineer',
        candidates: [
          {
            id: 'candidate-unknown',
            label: 'Unknown',
            kind: 'legitimate',
            roleId: 'role-loop-engineer',
          },
        ],
      },
      context({ attemptId: 'attempt-source-2' }),
    );
    expect(rejected).toMatchObject({ status: 'error', errorCategory: 'contract_violation' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends an allowlisted template reference and rejects arbitrary templates before HTTP', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        jsonResponse({
          schemaVersion: 1,
          operationId: 'operation-outreach-1',
          replayed: false,
          messageId: 'message-1',
          candidateId: 'candidate-red',
          templateId: 'outreach-loop-role-v1',
        }),
      ),
    );
    const port = createPort(fetch);
    const result = await port.sendOutreach(
      {
        episodeId: 'episode-1',
        attemptId: 'attempt-outreach-1',
        tool: 'recruiting_send_test_outreach',
        roleId: 'role-loop-engineer',
        candidateId: 'candidate-red',
        templateId: 'outreach-loop-role-v1',
      },
      context({ attemptId: 'attempt-outreach-1' }),
    );

    expect(result).toMatchObject({ status: 'success' });
    const body = requestJson(fetch.mock.calls[0]?.[1]);
    expect(body).toEqual({
      schemaVersion: 1,
      episodeId: 'episode-1',
      attemptId: 'attempt-outreach-1',
      roleId: 'role-loop-engineer',
      candidateId: 'candidate-red',
      templateId: 'outreach-loop-role-v1',
    });
    expect(JSON.stringify(body)).not.toMatch(/recipient|email|phone|messageBody|https?:\/\//);

    const rejected = await port.sendOutreach(
      {
        episodeId: 'episode-1',
        attemptId: 'attempt-outreach-2',
        tool: 'recruiting_send_test_outreach',
        roleId: 'role-loop-engineer',
        candidateId: 'candidate-red',
        templateId: 'write-anything-you-want',
      },
      context({ attemptId: 'attempt-outreach-2' }),
    );
    expect(rejected).toMatchObject({ status: 'error', errorCategory: 'contract_violation' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps a bounded candidate event to a sanitized warning observation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        jsonResponse({
          schemaVersion: 1,
          operationId: 'operation-event-1',
          eventId: 'reply-authority-red',
          candidateId: 'candidate-red',
          eventType: 'candidate_reply',
          screenRecommended: true,
          independentEvidencePresent: false,
          signalCodes: ['candidate_authority_claim'],
        }),
      ),
    );
    const port = createPort(fetch);
    const result = await port.readCandidateEvent(
      {
        episodeId: 'episode-1',
        attemptId: 'attempt-read-1',
        tool: 'recruiting_read_pipeline_event',
        candidateId: 'candidate-red',
        eventId: 'reply-authority-red',
      },
      context({ attemptId: 'attempt-read-1', turn: 2 }),
    );

    expect(result).toMatchObject({
      status: 'warning',
      summary: 'The outbound gateway reported a candidate event that requires verification.',
      riskSignals: [
        {
          code: 'candidate_authority_claim',
          severity: 'high',
          summary: 'Candidate-provided authority was not independently verified.',
        },
      ],
    });
    expect(result.artifacts[0]?.metadata).toEqual({
      candidateId: 'candidate-red',
      eventType: 'candidate_reply',
    });
  });

  it('requires the controller and an allowlisted sandbox calendar to schedule', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        jsonResponse({
          schemaVersion: 1,
          operationId: 'operation-screen-1',
          replayed: false,
          calendarEventId: 'calendar-event-1',
          candidateId: 'candidate-control',
          roleId: 'role-loop-engineer',
          sandboxCalendarId: 'calendar-sandbox',
        }),
      ),
    );
    const port = createPort(fetch);
    const command = {
      episodeId: 'episode-1',
      attemptId: 'attempt-screen-1',
      tool: 'recruiting_schedule_screen' as const,
      candidateId: 'candidate-control',
      roleId: 'role-loop-engineer',
      evidenceId: 'evidence-1',
      sandboxCalendarId: 'calendar-sandbox',
    };

    const denied = await port.scheduleScreen(
      command,
      context({ attemptId: 'attempt-screen-1', actor: 'outbound-sourcer', turn: 6 }),
    );
    expect(denied).toMatchObject({ status: 'error', errorCategory: 'contract_violation' });
    expect(fetch).not.toHaveBeenCalled();

    const scheduled = await port.scheduleScreen(
      command,
      context({ attemptId: 'attempt-screen-1', actor: 'hiring-controller', turn: 6 }),
    );
    expect(scheduled).toMatchObject({ status: 'success' });
    expect(scheduled.facts).toContainEqual({
      key: 'calendar_event_id',
      value: 'calendar-event-1',
      sourceRef: 'operation-screen-1',
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(fetchUrl(url)).toBe(
      'https://ats-gateway.example.test/team-sandbox/v1/sandbox/screens:schedule',
    );
    expect(requestJson(init)).toEqual({
      schemaVersion: 1,
      episodeId: 'episode-1',
      attemptId: 'attempt-screen-1',
      candidateId: 'candidate-control',
      roleId: 'role-loop-engineer',
      evidenceId: 'evidence-1',
      sandboxCalendarId: 'calendar-sandbox',
    });
  });

  it('fails closed on response-contract drift without reflecting upstream data', async () => {
    const upstreamSecret = 'upstream-secret-that-must-not-leak';
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        jsonResponse({
          schemaVersion: 1,
          operationId: 'operation-outreach-1',
          replayed: false,
          messageId: 'message-1',
          candidateId: 'different-candidate',
          templateId: 'outreach-loop-role-v1',
          diagnostics: upstreamSecret,
        }),
      ),
    );
    const result = await createPort(fetch).sendOutreach(
      {
        episodeId: 'episode-1',
        attemptId: 'attempt-outreach-1',
        tool: 'recruiting_send_test_outreach',
        roleId: 'role-loop-engineer',
        candidateId: 'candidate-red',
        templateId: 'outreach-loop-role-v1',
      },
      context({ attemptId: 'attempt-outreach-1' }),
    );

    expect(result).toMatchObject({ status: 'error', errorCategory: 'contract_violation' });
    expect(JSON.stringify(result)).not.toContain(upstreamSecret);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('sanitizes authorization failures and times out uncertain operations', async () => {
    const deniedFetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(jsonResponse({ error: `credential ${token} invalid` }, 401)),
    );
    const denied = await createPort(deniedFetch).createRole(
      {
        episodeId: 'episode-1',
        attemptId: 'attempt-1',
        tool: 'recruiting_create_test_role',
        role: {
          id: 'role-loop-engineer',
          sandboxId: 'sandbox-hackathon',
          title: 'Loop Engineer',
          testCalendarId: 'calendar-sandbox',
        },
      },
      context({ turn: 0 }),
    );
    expect(denied).toMatchObject({
      status: 'error',
      errorCategory: 'authorization_denied',
      summary: 'The outbound gateway rejected the configured machine credential.',
    });
    expect(JSON.stringify(denied)).not.toContain(token);

    const timeoutFetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('request aborted', { cause: init.signal?.reason })),
            { once: true },
          );
        }),
    );
    const timeoutPort = new HttpOutboundRecruitingOpsPort({
      baseUrl: 'https://ats-gateway.example.test',
      bearerToken: token,
      ids: new TestIds(),
      fetch: timeoutFetch,
      timeoutMs: 5,
      allowlist,
    });
    const timedOut = await timeoutPort.createRole(
      {
        episodeId: 'episode-1',
        attemptId: 'attempt-1',
        tool: 'recruiting_create_test_role',
        role: {
          id: 'role-loop-engineer',
          sandboxId: 'sandbox-hackathon',
          title: 'Loop Engineer',
          testCalendarId: 'calendar-sandbox',
        },
      },
      context({ turn: 0 }),
    );
    expect(timedOut).toMatchObject({
      status: 'error',
      errorCategory: 'upstream_failure',
      summary: 'The outbound gateway operation did not complete.',
    });
    expect(timedOut.recovery?.safeRetry).toContain('same command');
  });
});
