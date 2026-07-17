# PRP: Recruiting Loop Contracts and Core Engine

## Purpose

Replace the obsolete cyber-CTF model with the stable recruiting-loop contract that every parallel worktree can compile against. This is the only serial phase.

## Branch and ownership

- Branch: `codex/recruiting-engine-contracts`
- Base: the commit containing `docs/recruiting-loop-engine.md` and the worktree plans.
- Owns: `src/domain/**`, `src/engine/**`, `src/agents/**`, `fixtures/**`, core contract/engine tests.
- Does not own: sponsor adapters, UI, `compose.yaml`, or final runtime wiring.

## Existing patterns to preserve

- `src/domain/schemas.ts` uses strict Zod runtime schemas and an identifier schema. Preserve strict parsing at every boundary.
- `src/domain/types.ts` derives TypeScript types with `z.infer`; do not hand-maintain parallel interfaces.
- `src/domain/ports.ts` uses dependency-injected ports plus `Clock`, `IdGenerator`, and `EventSink`; retain this testability pattern.
- `tests/contracts.test.ts` loads a JSON fixture and parses every event. Keep fixture-backed contract validation.
- `tests/config.test.ts` treats blank secrets as absent. The integration branch will extend this pattern.

## Product behavior

Implement the deterministic episode in `docs/recruiting-loop-engine.md`:

1. Role and pipeline initialize.
2. Red candidate injects a social-engineering attempt.
3. Fillmore sourcer asks to schedule a screen.
4. Policy denies the sourcer identity.
5. White verifier diagnoses the evidence gap.
6. Zero capability evidence is collected and a regression is stored.
7. Hiring controller uses the same scheduling tool; policy allows it and Fillmore schedules a test event.
8. A mutated replay is blocked and both memories update.

## Contract design

### Enums

Define strict enums for:

- `ActorId`: `red-candidate`, `fillmore-sourcer`, `white-verifier`, `hiring-controller`, `arena`.
- `LoopPhase`: `sense`, `plan`, `request`, `authorize`, `execute`, `observe`, `learn`.
- `ObservationStatus`: `success`, `warning`, `error`.
- `ErrorCategory`: `authorization_denied`, `capability_unavailable`, `invalid_evidence`, `upstream_failure`, `budget_exceeded`, `contract_violation`.
- `EventKind`: the 20 recruiting event kinds specified by `docs/recruiting-loop-engine.md`.
- `RedTechnique`: `authority_spoof`, `urgency_pressure`, `portfolio_prompt_injection`, `credential_mismatch`.
- `VerificationNeed`: `public_page_capture`, `public_claim_lookup`.

### Authorization decision

Include:

- authenticated actor/service-account ID;
- requested tool name;
- `allow | deny` decision;
- policy reason codes;
- Pomerium request ID when present;
- occurred-at timestamp;
- no raw token, cookie, authorization header, or full tool parameters.

### Observation

Implement the strict observation contract from `docs/recruiting-loop-engine.md` with:

- identity: schema version, observation ID, episode/attempt IDs, turn, actor;
- result: status, summary, facts, risk signals, uncertainties;
- optional authorization decision;
- next actions and artifacts;
- optional recovery (`rootCauseHint`, `safeRetry`, `stopCondition`);
- provenance restricted to `fillmore`, `zero`, `pomerium-authorize-log`, `controller`, `test-world`;
- ISO timestamp.

Artifacts must have typed metadata and a safe reference/URI. Do not embed full page content, tokens, or candidate PII in the observation.

### Game event

Define strict, versioned `GameEvent`:

- global `sequence` is a non-negative integer and strictly increasing per episode;
- `turn` is 0–8;
- event has `kind`, `actor`, `summary`, `visualCue`, optional `observationId`, JSON payload, ISO timestamp;
- payload stays renderer-safe and contains no authority-bearing secrets.

### State and learning

Model:

- role brief and sandbox IDs;
- synthetic candidate records and pipeline state;
- pending action;
- evidence and regression records;
- red memory with technique attempts, reward, novelty, detection penalty, and cost;
- white memory with observed signals, defense, test, false-positive count, and canonical evidence hash;
- Zero capability selections and budget usage;
- metrics and ordered events.

Red scoring:

```text
score = success_reward + novelty + bypass_depth - detection_penalty - cost
```

Use deterministic numeric weights in one named policy object so tests can assert why the next technique was selected.

## Port surface

Replace the old generic CTF ports with explicit ports:

```ts
interface FillmorePort {
  createRole(input: CreateRoleCommand, context: ExecutionContext): Promise<Observation>;
  sourceCandidates(input: SourceCandidatesCommand, context: ExecutionContext): Promise<Observation>;
  sendOutreach(input: SendOutreachCommand, context: ExecutionContext): Promise<Observation>;
  readCandidateEvent(input: ReadCandidateEventCommand, context: ExecutionContext): Promise<Observation>;
  scheduleScreen(input: ScheduleScreenCommand, context: ExecutionContext): Promise<Observation>;
}

interface ZeroPort {
  discover(input: DiscoverCapabilityCommand, context: ExecutionContext): Promise<Observation>;
  invoke(input: InvokeCapabilityCommand, context: ExecutionContext): Promise<Observation>;
}

interface PolicyPort {
  authorize(input: AuthorizeToolCommand, context: ExecutionContext): Promise<Observation>;
}
```

Also retain `EventSink`, `Clock`, and `IdGenerator`. Commands must be strict discriminated unions with stable tool names. `scheduleScreen` must map to exactly one MCP tool name, `fillmore_schedule_screen`, so the Pomerium deny/allow proof cannot accidentally compare different operations.

## Actor tool maps

Commit an immutable typed map:

- `fillmore-sourcer`: create role, source, outreach, read candidate event; may request but not directly execute `fillmore_schedule_screen`.
- `white-verifier`: case read, Zero discover/invoke, evidence submit, regression store.
- `hiring-controller`: evidence read, `fillmore_schedule_screen`, episode complete.
- `red-candidate`: emits only synthetic candidate content/techniques; no sponsor tool credentials.

The engine should reject commands outside the actor’s declared set before invoking a port. Pomerium remains the external enforcement layer for MCP calls; the local check is a contract guard, not the demo’s authorization proof.

## Core engine

Create small modules, not one stateful script:

- `src/engine/coordinator.ts`: advances a single episode one loop phase at a time.
- `src/engine/reducer.ts`: pure state transition reducer.
- `src/engine/event-factory.ts`: converts state transitions/observations to `GameEvent`.
- `src/engine/termination.ts`: success, budget, repetition, and fatal-error stop rules.
- `src/engine/replay.ts`: applies a mutated candidate attempt to learned defenses.
- `src/agents/red-policy.ts`: deterministic technique scoring and mutation.
- `src/agents/white-policy.ts`: diagnosis, evidence sufficiency, regression selection.
- `src/agents/controller-policy.ts`: validates evidence before requesting side effects.
- `src/engine/fakes/**`: fake Fillmore, Zero, and Policy ports.

The coordinator receives all ports through its constructor. It must never import a concrete adapter.

## Implementation tasks

1. Delete old CTF actor, event, surface, flag, exploit, patch, and deployment schemas.
2. Add the recruiting enums and strict schemas.
3. Derive all public types from schemas.
4. Define the explicit sponsor ports and commands.
5. Add deterministic fake adapters with safe failure injection.
6. Implement pure reducer and termination rules.
7. Implement red/white/controller policies with inspectable memory updates.
8. Implement coordinator and ordered event publishing.
9. Replace `fixtures/contract-events.json` with `fixtures/recruiting-contract-events.json` containing the complete Turn 0–8 golden episode.
10. Replace old contract tests and add reducer, learning, replay, and termination tests.
11. Export a tiny text-only simulator used by adapter and pipeline developers.

## Edge cases

- Duplicate observation IDs are rejected.
- Out-of-order event sequences fail before publish.
- A denial is an expected observation, not an unhandled exception.
- Missing capability is recoverable once; repeated identical failure reaches a stop condition.
- Evidence without provenance, artifact hash, or regression reference cannot authorize scheduling.
- A tool result with success status but an invalid contract becomes `contract_violation`.
- Budget exhaustion terminates without a side effect.
- Replay must mutate one feature while preserving the same attack family; otherwise it does not prove learning.
- A controller allow decision without a subsequent Fillmore operation is not episode success.

## Tests

Required test cases:

- every schema accepts its golden fixture and rejects unknown keys;
- every actor tool map is exact;
- sourcer cannot execute the controller-only tool locally;
- Turn 3 denial leaves the episode recoverable;
- Zero evidence with valid provenance allows the controller to proceed;
- invalid/stale evidence is rejected;
- red policy selects the highest score and avoids repeated blocked variants;
- white policy stores a regression with a canonical hash;
- replay mutation is blocked by learned defense;
- global event sequence is monotonic and ends exactly once;
- fake ports can reproduce all expected failure categories;
- text simulator produces the same terminal state on repeated runs with the same seed.

## Validation

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
```

Coverage target: at least 90% branches for `src/engine/**` and `src/agents/**`, with explicit tests for every termination condition.

## Acceptance criteria

- No obsolete cyber-CTF term remains in runtime contracts or fixtures.
- One deterministic fake episode runs from Turn 0 through Turn 8 without credentials.
- The golden fixture parses with strict schemas.
- Every adapter plan can implement its port without editing `src/domain/**`.
- The UI can render the complete fixture without importing engine internals.
- The contract commit is tagged/recorded as the common SHA for all Phase 1 worktrees.

## Handoff

Publish the contract SHA and these four facts to every worktree owner:

1. exact port signatures;
2. exact tool names;
3. golden fixture path;
4. commands to run contract tests.

Any later shared-contract change requires a new core commit and an explicit rebase of every dependent branch.
