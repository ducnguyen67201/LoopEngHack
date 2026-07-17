# UI integration handoff

This UI is a presentation client. It consumes ordered `GameEvent` objects and never calls Zero,
Pomerium, Fillmore, or an agent directly.

Search the browser source for the explicit handoff markers:

```bash
rg "INTEGRATION\(" public
```

## Runtime wiring points

| Incoming component | Where it connects                                       | Canonical output                                                      |
| ------------------ | ------------------------------------------------------- | --------------------------------------------------------------------- |
| Agent loop         | Server-side `EventSink`                                 | Ordered domain `GameEvent` values                                     |
| Zero adapter       | Coordinator through `ZeroPort`, never `public/**`       | `zero_capability_discovered` and `verification_completed`             |
| Pomerium adapter   | Coordinator through `PolicyPort`                        | `policy_decision` with sanitized authorization metadata               |
| Recruiting adapter | Coordinator through `RecruitingOpsPort`                 | Recruiting observations ending in `screen_scheduled`                  |
| Pipeline runtime   | `POST /api/episodes` and `GET /api/episodes/:id/events` | SSE `id: <sequence>` plus one canonical event in each `data:` payload |

## Browser event boundary

The authoritative fixture is `fixtures/recruiting-contract-events.json`. The live stream preserves
the strict domain envelope:

```js
{
  (schemaVersion,
    id,
    episodeId,
    sequence,
    turn,
    occurredAt,
    actor,
    kind,
    phase,
    summary,
    visualCue,
    observationId,
    payload);
}
```

The browser derives presentation-only source/status labels from the canonical event kind. Sanitized
proof identifiers may be included in `payload`; `source`, `status`, and `proof` are not alternate wire
contracts. Never expose credentials, authorization headers, raw applicant content, private URLs, or
unrestricted tool parameters.

## Starting live mode

Run the connected fake pipeline:

```bash
npm run stream
```

Then open `http://127.0.0.1:8080/?mode=live`. With no episode ID, the browser calls
`POST /api/episodes`, updates the URL, and connects to:

```text
/?mode=live&episode=<bounded-episode-id>
```

Fake and recorded presentation modes use the exact same reducer. The only thing that changes is the
event source.

For the rehearsable offline fallback, run:

```bash
npm run demo
```

This serves the canonical bundled fixture and opens `/?autoplay=1`. It does not contact Zero,
Pomerium, a recruiting system, or the agent runtime.

## Sequence recovery

The reducer ignores duplicate sequences and pauses on a gap. The browser then closes the stream,
hydrates from the authoritative `GET /api/episodes/:id` event snapshot, and reconnects SSE from the
snapshot sequence. Normal network reconnects also honor `Last-Event-ID`. Do not fabricate missing
events in the browser.

The standalone local runtime permits one active episode and bounds completed/running retention to 20
episodes for 15 minutes. Keep authentication/rate limiting at the serving boundary before exposing
the endpoint beyond localhost.

## Safe extension rule

To add an engine event:

1. Add it to the server-owned domain contract.
2. Add a fixture example.
3. Add the event kind to `KNOWN_EVENT_KINDS` and a presentation-only reducer case.
4. Add a reducer test.

If the UI does not recognize an event, it renders a safe trace entry and continues the episode.
