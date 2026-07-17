# UI integration handoff

This UI is a presentation client. It consumes ordered `GameEvent` objects and never calls Zero,
Pomerium, Fillmore, or an agent directly.

Search the browser source for the explicit handoff markers:

```bash
rg "INTEGRATION\(" public
```

## Runtime wiring points

| Incoming branch  | Where to connect it                                                                | Required output                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Agent loop       | Server-side `EventSink`; see `INTEGRATION(agent-loop)` in `app.js`                 | Ordered, normalized `GameEvent` values                                                                |
| Zero adapter     | Coordinator/engine, never `public/**`                                              | `candidate_enriched`, `zero_discovery_*`, and `evidence_created` events with sanitized Zero proof IDs |
| Pomerium adapter | Protected MCP network path plus coordinator observation                            | `policy_denied` or `policy_allowed` with identity, identical tool name, reason, and request ID        |
| Fillmore adapter | Server-side recruiting port                                                        | `pipeline_created` and `screen_scheduled` with a sandbox operation ID                                 |
| Pipeline runtime | `GET /api/episodes/:id/events`; see `INTEGRATION(pipeline-runtime)` in `replay.js` | SSE messages with `id: <sequence>` and one JSON event in `data:`                                      |

## Browser event boundary

The fixture in `fixtures/hire-me-if-you-can-events.json` is the executable example. The live stream
must preserve these stable envelope fields:

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
    source,
    status,
    summary,
    visualCue,
    payload,
    proof);
}
```

Sponsor-specific responses belong behind adapters. Convert them to this envelope before publishing.
Never expose credentials, authorization headers, raw applicant content, private URLs, or unrestricted
tool parameters in `payload` or `proof`.

## Starting live mode

The pipeline serves `public/` and launches the UI at:

```text
/?mode=live&episode=<bounded-episode-id>
```

Fake and recorded presentation modes use the exact same reducer. The only thing that changes is the
event source.

## Sequence recovery

The reducer ignores duplicate sequences and pauses on a gap. When the pipeline branch lands, wire the
gap marker in `app.js` to the authoritative episode snapshot endpoint. Do not fabricate missing events
in the browser.

## Safe extension rule

To add an engine event:

1. Add it to the server-owned domain contract.
2. Add a fixture example.
3. Add the event kind to `KNOWN_EVENT_KINDS` and a presentation-only reducer case.
4. Add a reducer test.

If the UI does not recognize an event, it renders a safe trace entry and continues the episode.
