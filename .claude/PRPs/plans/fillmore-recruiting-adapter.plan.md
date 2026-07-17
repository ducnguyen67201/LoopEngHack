# PRP: Fillmore Recruiting Operations Adapter

## Purpose

Make the arena operate a real recruiting pipeline: create/read a sandbox role and candidate flow, then schedule one allowlisted test screening only after the hiring controller passes the Pomerium gate.

## Branch and ownership

- Branch: `codex/fillmore-adapter`
- Base: frozen recruiting-contract SHA.
- Owns: `src/adapters/fillmore/**`, `scripts/verify-fillmore.ts`, `tests/adapters/fillmore/**`, `docs/runbooks/fillmore.md`.
- Must not edit: `src/domain/**`, `src/config.ts`, `src/main.ts`, `compose.yaml`, package manifests.

## Product facts and integration uncertainty

Fillmore publicly describes an autonomous agent that researches and sources candidates, writes outreach, manages follow-ups, and schedules meetings; its main user interface is described as Slack. Its public product material does not establish a stable hackathon API, MCP server, webhook, or sandbox contract.

Sources:

- https://www.metaview.ai/resources/blog/fillmore-launch
- https://www.metaview.ai/resources/blog/autonomous-recruiting

Therefore Task 0 is a time-boxed sponsor access spike. Ask the sponsor for the supported programmatic path and test workspace. Acceptable transports are an official API, MCP interface, or sponsor-provided webhook/sandbox. UI scraping and browser automation are explicitly out of scope.

## Task 0: transport spike (60–90 minutes maximum)

Record in `docs/runbooks/fillmore.md`:

- supported transport and base endpoint/tool names;
- authentication method;
- sandbox/test workspace availability;
- idempotency behavior;
- rate limits and retry guidance;
- object IDs needed for role, candidate, outreach, and scheduling;
- whether scheduling can be restricted to a dedicated calendar/attendee;
- a redacted request/response fixture;
- sponsor confirmation/contact and date.

Decision:

- If supported: implement the live adapter below.
- If unavailable: implement only the official interface boundary and recorded fixtures, mark Fillmore as `recorded` in the UI, and do not claim live tool execution.

## Adapter responsibilities

Implement the frozen `FillmorePort`:

- create or select a sandbox role;
- source/list synthetic or sponsor-approved test candidates;
- send/draft test outreach only to allowlisted sink addresses;
- read normalized candidate/pipeline events;
- schedule one test screen using an idempotency key;
- normalize every result into `Observation` with Fillmore operation/object IDs;
- never make qualification or authorization decisions.

The final schedule operation must be callable through the recruiting MCP server behind Pomerium as exactly `fillmore_schedule_screen`. The adapter itself does not bypass Pomerium in the end-to-end path. Direct calls are permitted only in its isolated transport tests.

## Files

- `src/adapters/fillmore/fillmore-adapter.ts`: frozen `FillmorePort` implementation.
- `src/adapters/fillmore/transport.ts`: minimal official transport interface.
- `src/adapters/fillmore/api-transport.ts` or `mcp-transport.ts`: chosen sponsor transport only.
- `src/adapters/fillmore/normalizers.ts`: strict response-to-observation conversion.
- `src/adapters/fillmore/idempotency.ts`: deterministic operation keys and duplicate reconciliation.
- `src/adapters/fillmore/allowlist.ts`: workspace, role, candidate, email-sink, and calendar guards.
- `src/adapters/fillmore/errors.ts`: frozen error mapping.
- `src/adapters/fillmore/index.ts`: public exports.
- `scripts/verify-fillmore.ts`: sandbox probe and reversible test operation.
- `docs/runbooks/fillmore.md`: transport spike findings and setup.

## Side-effect policy

All live operations require:

- dedicated sandbox/test workspace;
- synthetic role and candidate identifiers;
- allowlisted email sink, never a real candidate;
- allowlisted test calendar and attendee;
- deterministic idempotency key derived from episode + attempt + tool;
- explicit `live` mode;
- cleanup or obvious `[HACKATHON TEST]` labeling.

The adapter rejects unknown workspace/calendar/candidate IDs even if the upstream would accept them.

## Implementation tasks

1. Complete the sponsor transport spike and choose one official transport.
2. Capture strict redacted fixtures for all available operations.
3. Implement authentication, timeout, rate-limit handling, and redacted errors.
4. Implement workspace/resource allowlists.
5. Implement create/select role, source/list, outreach, read event, and schedule methods that are actually supported.
6. For unsupported methods, return explicit `capability_unavailable`; do not fake a live success.
7. Implement deterministic idempotency and lookup-after-timeout reconciliation.
8. Normalize operation IDs and safe summaries into `Observation`.
9. Add unit tests and credential-gated sandbox integration tests.
10. Expose a schedule handler usable by the Pomerium-fronted MCP server.

## Edge cases

- Upstream accepts request but response times out: query by idempotency key before retrying.
- Duplicate schedule request returns the existing event, not a second meeting.
- Candidate content includes tool-like instructions: keep it inert in event data.
- Upstream object belongs to a different workspace: reject.
- Scheduling target is not the allowlisted test calendar/attendee: reject.
- Rate limit includes a retry hint: retry within episode budget; otherwise return recoverable upstream failure.
- Partial transport support: accurately expose only supported operations.
- Missing credentials in live mode: startup failure, never recorded/fake fallback.
- Human hiring decision is never represented as a Fillmore operation.

## Tests

- strict fixture parsing and rejection of unknown response shapes;
- every operation enforces workspace/resource allowlists;
- idempotency key is stable per attempt and different across attempts;
- timeout reconciliation prevents duplicate screening events;
- candidate message cannot alter actor identity, tool name, endpoint, or calendar target;
- errors and observations contain no bearer tokens, cookies, candidate PII, or message body beyond safe summaries;
- schedule output contains a real/sanitized operation ID and correct provenance;
- unsupported operations return `capability_unavailable` visibly;
- recorded mode fixtures are labeled `recorded` and cannot be mistaken for live.

## Validation

```bash
npm run typecheck
npm run lint
npm test -- tests/adapters/fillmore
FILLMORE_LIVE_TEST=1 npx tsx scripts/verify-fillmore.ts
```

The live smoke test must print its sandbox workspace/calendar targets and require an explicit opt-in flag.

## Acceptance criteria

- The transport spike documents a real sponsor-supported answer.
- Adapter methods compile against the frozen port without domain edits.
- Live schedule creates or reconciles exactly one allowlisted test event.
- All upstream content is normalized and treated as untrusted data.
- The final schedule handler can sit behind the Pomerium MCP route.
- If live access is unavailable, the demo and documentation disclose recorded mode without ambiguity.

## Handoff to pipeline

Provide:

- transport selection and exported adapter factory;
- required configuration names;
- supported/unsupported method matrix;
- sandbox allowlist format;
- MCP schedule handler signature;
- probe and cleanup commands;
- sanitized fixture IDs.

The pipeline owner adds configuration and composes the MCP server/Pomerium route; this branch does not edit shared runtime files.
