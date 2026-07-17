# Hire Me If You Can — Worktree Delivery Program

## Goal

Deliver one real, inspectable recruiting-agent loop in which a synthetic candidate attempts to manipulate an autonomous recruiting workflow, a verifier discovers and invokes an external capability through Zero, and Pomerium proves that only the correct agent identity can execute the final Fillmore scheduling tool.

The demo must make the loop visible:

`SENSE -> PLAN -> REQUEST -> AUTHORIZE -> EXECUTE -> OBSERVE -> LEARN`

This file is the dependency index. Each linked plan is independently executable from its declared base commit.

## Current repository state (2026-07-17)

Repository: `/Users/ducng/Desktop/workspace/Umbrella/loop-engine-hackathon`

| Item | Current state | Consequence |
| --- | --- | --- |
| Git | Branch `codex/project-structure`, commit `13c2940` | Good common scaffold commit |
| Working tree | Dirty: recruiting docs/runbook and these plans are untracked; `.env.example`, `README.md`, and `compose.yaml` contain an uncommitted Pomerium Zero bootstrap change; `zeroxyz-cli-1.26.0.tgz` is untracked | Review and split these changes before creating worktrees |
| Domain contracts | Compile and test, but model the obsolete cyber CTF | Must be replaced before adapters branch |
| Architecture | `docs/recruiting-loop-engine.md` defines the recruiting pivot | Use as the product source of truth |
| Engine | Interfaces only; no coordinator or learning loop | Core plan owns implementation |
| Pomerium | Compose placeholder and sanitized event schema only | No live MCP policy proof yet |
| Zero | No adapter | Capability discovery/invocation must be added |
| Fillmore | No adapter | Transport availability must be verified first |
| UI | No browser UI or sprites | UI can start from committed event fixtures |
| Validation | Old scaffold tests pass; they do not validate the recruiting design | Replace fixtures/tests; do not count current green build as product completion |

## Non-negotiable architecture

- `src/domain/**` is the only source of truth for cross-worktree contracts.
- The engine emits `GameEvent`; the UI renders it and never owns the episode state machine.
- Candidate text is untrusted data, never an authorization instruction.
- Pomerium answers “may this authenticated identity call this MCP tool?”
- The controller answers “does the evidence justify this business action?”
- Fillmore performs recruiting operations; it does not decide whether evidence is trustworthy.
- Zero discovers/invokes an allowlisted verification capability and returns provenance.
- Real mode never silently falls back to fake mode.
- The only external side effect in the demo is a test screening event in an allowlisted sandbox calendar. Hiring remains a human decision.

## Dependency graph

```text
Phase 0 (serial)
  recruiting-engine-contracts
           |
           +----------------+----------------+----------------+----------------+
           |                |                |                |                |
Phase 1    v                v                v                v                v
       pomerium          zero           fillmore          game-ui       pipeline-shell
       adapter          adapter          adapter          renderer      (fake ports)
           |                |                |                |                |
           +----------------+----------------+----------------+----------------+
                                            |
Phase 2                                     v
                                  pipeline integration
                                            |
Phase 3                                     v
                                  live proof + demo rehearsal
```

Phase 0 is short and serial because all later branches compile against it. After its commit SHA is frozen, every Phase 1 worktree can proceed concurrently. The pipeline worktree may implement its coordinator/server against fake ports while adapters are being built; it merges the adapter branches only after their contract tests pass.

## Plans and exclusive ownership

| Plan | Branch | Exclusive ownership | Starts |
| --- | --- | --- | --- |
| [Core contracts and engine](./recruiting-engine-core.plan.md) | `codex/recruiting-engine-contracts` | `src/domain/**`, `src/engine/**`, `src/agents/**`, recruiting fixtures and core tests | First; serial |
| [Pomerium adapter](./pomerium-recruiting-adapter.plan.md) | `codex/pomerium-adapter` | `src/adapters/pomerium/**`, `config/pomerium/**`, Pomerium tests/runbook/smoke script | After contract freeze |
| [Zero adapter](./zero-verification-adapter.plan.md) | `codex/zero-adapter` | `src/adapters/zero/**`, Zero tests/runbook/smoke script | After contract freeze |
| [Fillmore adapter](./fillmore-recruiting-adapter.plan.md) | `codex/fillmore-adapter` | `src/adapters/fillmore/**`, Fillmore tests/runbook/smoke script | After contract freeze |
| [8-bit game UI](./recruiting-game-ui.plan.md) | `codex/recruiting-game-ui` | `public/**`, `assets/sprites/**`, UI tests | After contract fixture freeze |
| [Pipeline integration](./recruiting-pipeline-integration.plan.md) | `codex/recruiting-pipeline` | `src/runtime/**`, `src/server/**`, `src/main.ts`, `src/config.ts`, `compose.yaml`, `.env.example`, integration/E2E tests | Shell after contract freeze; live wiring after adapters |

Ownership rule: a worktree must not edit another row’s files. If an adapter discovers a contract gap, record the requested change in its runbook and make the actual domain change on the core branch before rebasing all dependent branches. Do not independently “fix” shared types in multiple worktrees.

`package.json` and `package-lock.json` are owned by the pipeline branch after the contract freeze. Adapter implementations should use Node `fetch`, the already-installed MCP SDK, and built-in process APIs. If a new dependency is truly required, send the exact dependency/version requirement to the pipeline owner.

## Worktree setup

### 1. Make the current design durable without mixing the bootstrap spike

From the current repository:

```bash
cd /Users/ducng/Desktop/workspace/Umbrella/loop-engine-hackathon
git add docs/recruiting-loop-engine.md .claude/PRPs/plans
git commit -m "docs(plan): define recruiting loop delivery program"
```

The existing Pomerium Zero bootstrap edits are separate work and should receive their own review/commit:

```bash
git diff -- .env.example README.md compose.yaml
git add .env.example README.md compose.yaml docs/runbooks/pomerium-zero-bootstrap.md
git commit -m "chore(pomerium): document Zero data-plane bootstrap"
```

Do not commit `zeroxyz-cli-1.26.0.tgz`; it is a downloaded package artifact. Inspect it in a temporary directory if needed, then delete it or add the exact artifact pattern to `.gitignore` in a deliberate cleanup commit.

Before proceeding, require a clean status:

```bash
git status --short
```

Do not create worktrees while design/runbook files are untracked; untracked files are not inherited. Do not use `git add .` here because that would also stage the Zero tarball.

### 2. Create and finish the contract worktree

```bash
git worktree add ../loop-engine-contracts -b codex/recruiting-engine-contracts HEAD
```

Implement [recruiting-engine-core.plan.md](./recruiting-engine-core.plan.md), run its validation, and commit. Record the immutable foundation SHA:

```bash
CONTRACT_SHA=$(git -C ../loop-engine-contracts rev-parse HEAD)
echo "$CONTRACT_SHA"
```

### 3. Create all Phase 1 worktrees from exactly that SHA

```bash
git worktree add ../loop-engine-pomerium -b codex/pomerium-adapter "$CONTRACT_SHA"
git worktree add ../loop-engine-zero -b codex/zero-adapter "$CONTRACT_SHA"
git worktree add ../loop-engine-fillmore -b codex/fillmore-adapter "$CONTRACT_SHA"
git worktree add ../loop-engine-ui -b codex/recruiting-game-ui "$CONTRACT_SHA"
git worktree add ../loop-engine-pipeline -b codex/recruiting-pipeline "$CONTRACT_SHA"
```

Never create one adapter branch from another adapter branch. They must be siblings rooted at the same contract SHA.

### 4. Merge adapters into the pipeline branch

Only the pipeline branch receives the sibling implementations:

```bash
cd ../loop-engine-pipeline
git merge --no-ff codex/pomerium-adapter
git merge --no-ff codex/zero-adapter
git merge --no-ff codex/fillmore-adapter
git merge --no-ff codex/recruiting-game-ui
```

Because file ownership is disjoint, these merges should be mechanical. A conflict in `src/domain/**`, `src/config.ts`, `src/main.ts`, `compose.yaml`, or lockfiles means a branch crossed its ownership boundary; stop and correct that branch rather than hand-merging divergent architecture.

## Frozen contract surface before parallel work

Phase 0 must commit all of these:

- Actor IDs: `red-candidate`, `fillmore-sourcer`, `white-verifier`, `hiring-controller`.
- The seven loop phases.
- Strict `Observation`, `AuthorizationDecision`, `GameEvent`, `EpisodeState`, memory, evidence, and recovery schemas.
- `FillmorePort`, `ZeroPort`, `PolicyPort`, `EventSink`, `Clock`, and `IdGenerator` interfaces.
- Exact tool names and per-actor tool maps.
- Fake adapters that make every port executable without credentials.
- One deterministic Turn 0–8 fixture covering deny, discover, verify, allow, replay-block, and learn.
- Stable error categories: `authorization_denied`, `capability_unavailable`, `invalid_evidence`, `upstream_failure`, `budget_exceeded`, `contract_violation`.

If these are not stable, the adapter branches will drift.

## Integration contract

Every real adapter returns a normalized `Observation`; it never publishes UI events directly. The coordinator is the only component allowed to turn observations into ordered `GameEvent`s.

```ts
const observation = await port.execute(command, context);
const nextState = reducer.applyObservation(state, observation);
await eventSink.publish(eventFactory.fromObservation(nextState, observation));
```

That boundary permits:

- fake, recorded, and live adapters with identical engine behavior;
- deterministic tests without sponsor credentials;
- a replayable three-minute demo;
- adapter replacement without UI changes;
- one global event sequence with no duplicate or out-of-order turns.

## Final live pipeline

```text
Synthetic candidate message
  -> Fillmore pipeline event
  -> Sourcer requests fillmore_schedule_screen through MCP
  -> Pomerium DENY (sourcer identity cannot call tool)
  -> White verifier requests a verification capability
  -> Zero discovers + invokes an allowlisted public-proof capability
  -> Controller validates evidence artifact + regression
  -> Controller requests the same fillmore_schedule_screen tool
  -> Pomerium ALLOW
  -> Fillmore creates allowlisted test screening event
  -> Mutated attack replays and is blocked
  -> Both agents update inspectable memory
```

The same-tool deny/allow contrast is the Pomerium “wow” moment. Zero is not decorative because the verification capability is chosen at runtime. Fillmore is not decorative because the allowed action produces the final recruiting side effect.

## Configuration modes

Use an explicit mode, never an implicit fallback:

- `fake`: deterministic local adapters; CI and core development.
- `recorded`: replay sanitized observations captured from a successful live run; presentation backup.
- `live`: all selected sponsor adapters must pass startup probes or the process exits non-zero.

Do not label a recorded or fake response as live in the UI. Show a persistent mode badge.

## Global validation gates

Before adapter merge:

```bash
npm run typecheck
npm run lint
npm test
```

Before declaring the pipeline complete:

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run test:coverage
docker compose config
docker compose up --build --wait
```

Required live evidence:

1. Pomerium authorization log for sourcer + `fillmore_schedule_screen` = deny.
2. Pomerium authorization log for controller + the identical tool = allow.
3. Zero result containing capability ID, provider/provenance, invocation ID, and bounded spend.
4. Fillmore result containing a real sandbox operation ID or calendar event ID.
5. Engine event stream containing one monotonically increasing sequence from Turn 0 through Turn 8.
6. Replay test demonstrating the learned defense blocks a mutation without a manual rule change mid-episode.

## Sponsor constraints verified during planning

- Pomerium MCP routes proxy Streamable HTTP servers and can authorize `tools/call` by `mcp_tool`; the criterion does not apply to `tools/list`, so tool checks belong under `deny`. MCP support is documented as experimental on `main`, so pin a tested image digest before demo day. Sources: https://www.pomerium.com/docs/capabilities/mcp/protect-mcp-server and https://www.pomerium.com/docs/capabilities/mcp/limit-mcp-tools
- Pomerium machine identities can authenticate with service-account JWTs, including `Authorization: Bearer Pomerium-${JWT}`. Do not place the JWT in events or logs. Source: https://www.pomerium.com/docs/capabilities/service-accounts
- Zero describes itself as a search and payment layer for agent capabilities, distributed through a CLI/skill/hooks/MCP connector. The adapter must discover and invoke rather than hardcode a vendor-specific verifier. Source: https://github.com/officialzeroxyz/zero-plugins
- Fillmore publicly describes sourcing, research, outreach, follow-up, and scheduling, usually controlled through Slack. Its public product material does not establish the exact hackathon API/MCP contract; the adapter plan therefore begins with a sponsor-access spike. Sources: https://www.metaview.ai/resources/blog/fillmore-launch and https://www.metaview.ai/resources/blog/autonomous-recruiting

## Stop conditions

- If no official Fillmore programmatic transport or sandbox is available, do not scrape or automate its UI. Keep the adapter contract and use recorded mode for that leg while explicitly disclosing it.
- If Pomerium’s experimental MCP build cannot be pinned and run reliably, use a tested sponsor-provided image/tag; do not replace the policy proof with an in-app boolean.
- If Zero can discover capabilities but cannot be invoked non-interactively in the runtime, preserve the discovery as a real preflight and invoke through the sponsor-supported MCP/CLI path. Do not invent a REST endpoint.
- Never run the demo against real candidates, real hiring calendars, or production recruiting workspaces.

## Definition of done

The project is complete when a clean checkout can run the deterministic episode, the UI visibly renders each event, live mode produces sponsor provenance for each integration, the same Pomerium-gated tool is denied for one identity and allowed for another, the final side effect is confined to a sandbox calendar, and the next replay is blocked because persisted loop memory changed—not because the presenter clicked a hidden control.
