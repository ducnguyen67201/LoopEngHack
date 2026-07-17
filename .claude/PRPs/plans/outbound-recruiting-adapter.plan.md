# PRP: Local Outbound Recruiting Adapter

## Purpose

Implement a controlled outbound recruiting pipeline without depending on access to a third-party recruiting platform. The adapter performs real domain work against synthetic candidates and test resources while keeping the engine vendor-neutral.

## Branch and ownership

- Branch: `codex/outbound-recruiting-adapter`
- Base: frozen recruiting-contract SHA.
- Owns: `src/adapters/outbound/**`, `tests/adapters/outbound/**`, `fixtures/outbound/**`, and `docs/runbooks/outbound.md`.
- Must not edit shared domain, runtime composition, Compose, or package manifests.

## Port and tools

Implement `RecruitingOpsPort` for sandbox role creation, synthetic candidate sourcing, test outreach, reply ingestion, and idempotent test scheduling.

Expose exact generic MCP tools:

- `recruiting_create_test_role`
- `recruiting_source_test_candidates`
- `recruiting_send_test_outreach`
- `recruiting_read_pipeline_event`
- `recruiting_request_screen`
- `recruiting_schedule_screen`

Pomerium denies `recruiting_schedule_screen` for `outbound-sourcer` and allows the identical tool for `hiring-controller`.

## Storage

Use an append-only JSONL event store plus in-memory projections. Store the role, synthetic candidates, campaign/message, untrusted reply, evidence reference, screening event, and idempotency record. Replaying the log must rebuild the same projection deterministically.

## Files

- `src/adapters/outbound/local-outbound-adapter.ts`
- `src/adapters/outbound/event-store.ts`
- `src/adapters/outbound/projections.ts`
- `src/adapters/outbound/outreach-templates.ts`
- `src/adapters/outbound/message-sink.ts`
- `src/adapters/outbound/calendar-sink.ts`
- `src/adapters/outbound/idempotency.ts`
- `src/adapters/outbound/allowlist.ts`
- `src/adapters/outbound/index.ts`
- `tests/adapters/outbound/**`
- `fixtures/outbound/**`
- `docs/runbooks/outbound.md`

## Safety rules

- Candidate messages never select tools, actors, URLs, templates, calendars, or recipients.
- All candidates are synthetic.
- Messages go only to an allowlisted test inbox.
- Calendar actions target a dedicated test calendar with `[HACKATHON TEST]` labels.
- An episode may create at most one screening event.
- Evidence IDs and hashes are resolved server-side.
- No browser automation of a third-party recruiting UI.

## Implementation tasks

1. Implement append-only storage and deterministic projections.
2. Implement sandbox role and candidate creation.
3. Implement server-owned outreach templates and controlled delivery.
4. Implement synthetic reply ingestion as untrusted data.
5. Implement resource allowlists and idempotent test scheduling.
6. Normalize strict observations with `recruiting-pipeline` provenance.
7. Add failure injection and adapter tests.
8. Document startup, test data, cleanup, and evidence capture.

## Tests

- conflicting role/candidate IDs fail closed;
- candidate content cannot change tool name or actor;
- unknown recipients/calendars are rejected;
- retry returns the existing screening event;
- schedule requires controller-approved evidence;
- event replay rebuilds the same projection;
- observations contain no secrets or real candidate PII.

## Validation

```bash
npm run typecheck
npm run lint
npm test -- tests/adapters/outbound
```

## Acceptance criteria

- `RecruitingOpsPort` passes frozen contract tests.
- The pipeline runs completely with synthetic inputs and test sinks.
- `recruiting_schedule_screen` creates exactly one safe test event after controller authorization.
- The adapter can later be replaced without changing engine or UI contracts.
