# Google Calendar sandbox runbook

This adapter creates one evidence-bound screening event on exactly one configured Google Calendar.
It uses the Calendar v3 `events.insert` endpoint with a caller-supplied OAuth access token and
`sendUpdates=none`. Google notes that notification suppression is not an absolute delivery guarantee,
so the attendee must be a team-controlled sandbox address, never a real candidate.

## Prerequisites

1. Create or select a secondary calendar used only for the demo.
2. Give the OAuth identity write access to that calendar.
3. Authorize the identity with `https://www.googleapis.com/auth/calendar.events` (or a narrower
   Calendar events scope that still permits writes to this calendar).
4. Use only a team-controlled attendee address and a harmless demo time window.

Do not use `primary` as the calendar ID. Do not reuse a personal or production recruiting calendar.

## Environment

The adapter factory reads two required values, while the live episode-manager composition also
requires the server-owned attendee and time window:

```dotenv
GOOGLE_CALENDAR_OAUTH_ACCESS_TOKEN=<short-lived OAuth access token>
GOOGLE_CALENDAR_SANDBOX_ID=<the exact secondary calendar ID>
SANDBOX_CALENDAR_ATTENDEE_EMAIL=<team-controlled test address>
SANDBOX_SCREEN_START_AT=2026-07-18T18:00:00Z
SANDBOX_SCREEN_END_AT=2026-07-18T18:30:00Z
```

One optional timeout is supported:

```dotenv
GOOGLE_CALENDAR_TIMEOUT_MS=10000
```

The timeout must be an integer from 1 through 60000. Keep these values server-side. Never expose the
token to browser JavaScript, event payloads, logs, MCP output, or checked-in files.

## Protected-handler integration

`EpisodeManager` creates the port once when `CALENDAR_MODE=google`, then calls it only after
Pomerium authorization and local evidence validation have succeeded. The protected MCP input uses
the logical allowlisted ID `calendar-sandbox`; the server translates that alias to the configured
provider calendar ID rather than accepting a provider target from the caller. The underlying call
is equivalent to:

```ts
import {
  createGoogleCalendarSandboxPortFromEnv,
  type CalendarSchedulePort,
} from '../../adapters/calendar/index.js';

const calendar: CalendarSchedulePort = createGoogleCalendarSandboxPortFromEnv();

const result = await calendar.scheduleScreen({
  sandboxCalendarId: configuredGoogleSandboxCalendarId,
  episodeId: verifiedInput.episodeId,
  evidenceId: verifiedInput.evidenceId,
  candidateId: verifiedInput.candidateId,
  roleId: verifiedInput.roleId,
  attendeeEmail: configuredTeamSandboxAttendee,
  title: 'Sandbox engineering screen',
  description: 'Evidence-backed hackathon sandbox operation.',
  startAt: configuredStartAt,
  endAt: configuredEndAt,
});
```

`attendeeEmail`, `title`, `description`, `startAt`, and `endAt` must come from server-owned demo
configuration. Do not infer contact data or schedule text from candidate content.

The only returned fields are `operationId`, `eventId`, and `idempotentReplay`. Do not forward the
Google response body through MCP.

## Safety and idempotency

- The requested calendar must exactly match `GOOGLE_CALENDAR_SANDBOX_ID`.
- Exactly one bounded attendee is accepted; title is limited to 120 characters and description to
  2,000 characters.
- Start and end must be RFC3339 date-times with an explicit offset. Duration is limited to five
  minutes through eight hours.
- Event and operation IDs are deterministic for the calendar, episode, evidence, candidate, and
  role. Repeating the same operation cannot create a second event.
- A Google `409` is not trusted by itself. The adapter reads the existing event and accepts it only
  when its private binding hash exactly matches the requested evidence and content.
- The event is private, has reminders disabled, and prevents guests from modifying or inviting.
- Authentication, authorization, timeout, protocol, and upstream failures are normalized without
  returning Google diagnostics or credentials.

## Verification

Run the isolated suite without making a real Calendar request:

```sh
npm test -- --run tests/adapters/calendar/google-calendar-sandbox.test.ts
npx eslint src/adapters/calendar tests/adapters/calendar
npx prettier --check src/adapters/calendar tests/adapters/calendar docs/runbooks/sandbox-calendar.md
```

For an explicitly approved sandbox smoke test, use one synthetic episode and verify that the returned
`eventId` exists only on the configured secondary calendar. Run the same input again and require
`idempotentReplay: true` with the same IDs. This repository does not perform that external write or
automatically delete calendar data.

## Failure guide

| Kind                    | Meaning                                       | Retry                              |
| ----------------------- | --------------------------------------------- | ---------------------------------- |
| `authentication_failed` | OAuth token was rejected                      | Refresh the token first            |
| `permission_denied`     | Identity cannot write to the sandbox          | Fix calendar sharing/scope first   |
| `calendar_not_allowed`  | Input targets a different calendar            | Never retry with a broader target  |
| `idempotency_conflict`  | Existing deterministic ID has another binding | Stop and inspect the sandbox       |
| `timeout`               | Calendar did not respond in time              | Safe to retry with identical input |
| `upstream_failure`      | Network, quota, or Google 5xx failure         | Retry with identical input/backoff |
| `protocol_error`        | Google rejected or returned an invalid event  | Stop and inspect server logs       |

API references: [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert),
[events.get](https://developers.google.com/workspace/calendar/api/v3/reference/events/get), and
[resource versioning/idempotent IDs](https://developers.google.com/workspace/calendar/api/guides/version-resources).
