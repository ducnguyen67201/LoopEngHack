import { describe, expect, it, vi } from 'vitest';

import {
  CalendarAdapterError,
  createGoogleCalendarSandboxPort,
  createGoogleCalendarSandboxPortFromEnv,
  type ScheduleSandboxScreenInput,
} from '../../../src/adapters/calendar/index.js';

const accessToken = 'google-oauth-access-token-for-sandbox-tests';
const calendarId = 'sandbox-calendar@example.test';

const input: ScheduleSandboxScreenInput = {
  sandboxCalendarId: calendarId,
  episodeId: 'episode-1',
  evidenceId: 'evidence-1',
  candidateId: 'candidate-1',
  roleId: 'role-1',
  attendeeEmail: 'candidate@example.test',
  title: 'Sandbox engineering screen',
  description: 'Evidence-backed sandbox screen for candidate-1.',
  startAt: '2026-07-20T10:00:00-07:00',
  endAt: '2026-07-20T10:30:00-07:00',
};

describe('GoogleCalendarSandboxPort', () => {
  it('rejects the primary calendar as a sandbox target', () => {
    expect(() =>
      createGoogleCalendarSandboxPort({
        accessToken,
        sandboxCalendarId: 'primary',
      }),
    ).toThrow('Google sandbox calendar ID is invalid');
  });

  it('creates one private, evidence-bound event on the allowlisted calendar', async () => {
    const calls: Array<{ url: URL; init: RequestInit | undefined; body?: unknown }> = [];
    const fetch = vi.fn<typeof globalThis.fetch>((request, init) => {
      const url = new URL(request instanceof Request ? request.url : request.toString());
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ url, init, body });
      const event = body as {
        id: string;
        extendedProperties: { private: Record<string, string> };
      };
      return Promise.resolve(
        Response.json({
          id: event.id,
          extendedProperties: event.extendedProperties,
          htmlLink: 'https://calendar.google.com/calendar/event?secret=must-not-escape',
          attendees: [{ email: input.attendeeEmail }],
        }),
      );
    });
    const calendar = createGoogleCalendarSandboxPort({
      accessToken,
      sandboxCalendarId: calendarId,
      fetch,
    });

    const result = await calendar.scheduleScreen(input);

    expect(Object.keys(result).sort()).toEqual(['eventId', 'idempotentReplay', 'operationId']);
    expect(result.idempotentReplay).toBe(false);
    expect(result.eventId).toMatch(/^screen[0-9a-f]{64}$/);
    expect(result.operationId).toMatch(/^calendar[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain('calendar.google.com');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.href).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/sandbox-calendar%40example.test/events?sendUpdates=none',
    );
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe(`Bearer ${accessToken}`);
    expect(calls[0]?.body).toMatchObject({
      id: result.eventId,
      summary: input.title,
      description: input.description,
      attendees: [{ email: input.attendeeEmail }],
      start: { dateTime: input.startAt },
      end: { dateTime: input.endAt },
      visibility: 'private',
      guestsCanInviteOthers: false,
      guestsCanModify: false,
      guestsCanSeeOtherGuests: false,
      reminders: { useDefault: false },
      extendedProperties: {
        private: {
          loop_operation_id: result.operationId,
          loop_episode_id: input.episodeId,
          loop_evidence_id: input.evidenceId,
          loop_candidate_id: input.candidateId,
          loop_role_id: input.roleId,
        },
      },
    });
  });

  it('treats a matching 409 event as an idempotent replay after reading it back', async () => {
    let postedEventId = '';
    let postedPrivateProperties: Record<string, string> = {};
    const methods: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>((_request, init) => {
      const method = init?.method ?? 'GET';
      methods.push(method);
      if (method === 'POST') {
        const postedBody = JSON.parse(requireStringBody(init)) as {
          id: string;
          extendedProperties: { private: Record<string, string> };
        };
        postedEventId = postedBody.id;
        postedPrivateProperties = postedBody.extendedProperties.private;
        return Promise.resolve(
          Response.json({ error: { message: 'Already exists' } }, { status: 409 }),
        );
      }
      return Promise.resolve(
        Response.json({
          id: postedEventId,
          extendedProperties: { private: postedPrivateProperties },
        }),
      );
    });
    const calendar = createGoogleCalendarSandboxPort({
      accessToken,
      sandboxCalendarId: calendarId,
      fetch,
    });

    const result = await calendar.scheduleScreen(input);

    expect(methods).toEqual(['POST', 'GET']);
    expect(result).toEqual({
      operationId: postedPrivateProperties.loop_operation_id,
      eventId: postedEventId,
      idempotentReplay: true,
    });
  });

  it('fails closed when a 409 event does not have the exact evidence binding', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_request, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(new Response(null, { status: 409 }));
      }
      return Promise.resolve(
        Response.json({
          id: 'screen00000',
          extendedProperties: { private: { loop_binding_hash: 'some-other-operation' } },
        }),
      );
    });
    const calendar = createGoogleCalendarSandboxPort({
      accessToken,
      sandboxCalendarId: calendarId,
      fetch,
    });

    await expect(calendar.scheduleScreen(input)).rejects.toMatchObject({
      name: 'CalendarAdapterError',
      kind: 'idempotency_conflict',
      retriable: false,
      message: 'The deterministic calendar event ID is already bound to another operation',
    });
  });

  it('rejects every calendar except the single configured sandbox before fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const calendar = createGoogleCalendarSandboxPort({
      accessToken,
      sandboxCalendarId: calendarId,
      fetch,
    });

    await expect(
      calendar.scheduleScreen({ ...input, sandboxCalendarId: 'primary' }),
    ).rejects.toMatchObject({ kind: 'calendar_not_allowed', retriable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing evidence', { evidenceId: '' }],
    ['too many title characters', { title: 't'.repeat(121) }],
    ['too many description characters', { description: 'd'.repeat(2_001) }],
    ['invalid attendee', { attendeeEmail: 'not-an-email' }],
    ['too many attendee characters', { attendeeEmail: `${'a'.repeat(250)}@example.test` }],
    ['invalid start', { startAt: 'next Tuesday' }],
    ['end before start', { endAt: '2026-07-20T09:30:00-07:00' }],
    ['screen longer than eight hours', { endAt: '2026-07-20T19:00:00-07:00' }],
  ])('rejects %s before fetch', async (_label, override) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const calendar = createGoogleCalendarSandboxPort({
      accessToken,
      sandboxCalendarId: calendarId,
      fetch,
    });

    await expect(calendar.scheduleScreen({ ...input, ...override })).rejects.toMatchObject({
      kind: 'invalid_input',
      retriable: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses deterministic IDs and rejects changed replay content as a binding conflict', async () => {
    const posted: Array<{
      id: string;
      extendedProperties: { private: Record<string, string> };
    }> = [];
    const fetch = vi.fn<typeof globalThis.fetch>((_request, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(requireStringBody(init)) as (typeof posted)[number];
        posted.push(body);
        if (posted.length === 1) {
          return Promise.resolve(
            Response.json({ id: body.id, extendedProperties: body.extendedProperties }),
          );
        }
        return Promise.resolve(new Response(null, { status: 409 }));
      }
      return Promise.resolve(
        Response.json({
          id: posted[0]?.id,
          extendedProperties: posted[0]?.extendedProperties,
        }),
      );
    });
    const calendar = createGoogleCalendarSandboxPort({
      accessToken,
      sandboxCalendarId: calendarId,
      fetch,
    });

    const first = await calendar.scheduleScreen(input);
    await expect(
      calendar.scheduleScreen({ ...input, description: 'A changed description.' }),
    ).rejects.toMatchObject({ kind: 'idempotency_conflict' });
    expect(posted[0]?.id).toBe(first.eventId);
    expect(posted[1]?.id).toBe(first.eventId);
    expect(posted[1]?.extendedProperties.private.loop_binding_hash).not.toBe(
      posted[0]?.extendedProperties.private.loop_binding_hash,
    );
  });

  it.each([
    [401, 'authentication_failed', false],
    [403, 'permission_denied', false],
    [429, 'upstream_failure', true],
    [500, 'upstream_failure', true],
  ] as const)(
    'normalizes Google HTTP %i without exposing the response body',
    async (status, kind, retriable) => {
      const fetch = vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(new Response('secret Google diagnostic body', { status })),
      );
      const calendar = createGoogleCalendarSandboxPort({
        accessToken,
        sandboxCalendarId: calendarId,
        fetch,
      });

      let thrown: unknown;
      try {
        await calendar.scheduleScreen(input);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CalendarAdapterError);
      expect(thrown).toMatchObject({ kind, retriable });
      expect(String(thrown)).not.toContain('secret Google diagnostic body');
      expect(String(thrown)).not.toContain(accessToken);
    },
  );

  it('aborts a timed-out request and reports a retriable timeout', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_request, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted with secret')));
        }),
    );
    const calendar = createGoogleCalendarSandboxPort({
      accessToken,
      sandboxCalendarId: calendarId,
      fetch,
      timeoutMs: 5,
    });

    await expect(calendar.scheduleScreen(input)).rejects.toMatchObject({
      kind: 'timeout',
      retriable: true,
      message: 'Google Calendar did not respond before the configured timeout',
    });
  });

  it('rejects malformed configuration without echoing secrets', () => {
    const secretWithWhitespace = 'secret-token\nshould-not-escape';

    expect(() =>
      createGoogleCalendarSandboxPort({
        accessToken: secretWithWhitespace,
        sandboxCalendarId: calendarId,
      }),
    ).toThrow('Google Calendar OAuth access token is invalid');
    try {
      createGoogleCalendarSandboxPort({
        accessToken: secretWithWhitespace,
        sandboxCalendarId: calendarId,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secretWithWhitespace);
    }
  });

  it('builds from the two required explicit environment fields', () => {
    expect(() =>
      createGoogleCalendarSandboxPortFromEnv({
        GOOGLE_CALENDAR_OAUTH_ACCESS_TOKEN: accessToken,
      }),
    ).toThrow('GOOGLE_CALENDAR_SANDBOX_ID is required');

    const calendar = createGoogleCalendarSandboxPortFromEnv({
      GOOGLE_CALENDAR_OAUTH_ACCESS_TOKEN: accessToken,
      GOOGLE_CALENDAR_SANDBOX_ID: calendarId,
      GOOGLE_CALENDAR_TIMEOUT_MS: '2000',
    });

    expect(calendar).toBeDefined();
  });
});

function requireStringBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new Error('expected a JSON request body');
  return init.body;
}
