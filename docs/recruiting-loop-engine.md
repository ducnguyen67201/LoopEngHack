# Hire Me If You Can — Core Loop Engine

## Status

Architecture specification for the recruiting-game pivot. This document defines the engine before character art, UI animation, or sponsor adapters are implemented.

The existing project contracts describe the earlier web-security CTF. They must be migrated to this recruiting domain before the target, agent, runtime, or UI lanes continue. Do not build new features against both models simultaneously.

## Product sentence

> Synthetic applicant agents try to manipulate an autonomous recruiting workflow into advancing them; Fillmore operates the recruiting pipeline, Zero discovers verification capabilities, and Pomerium ensures only the correct agent identity can perform each hiring action.

## Design principles

1. **The engine is real; the game is its renderer.** The UI never advances a turn or fabricates a result.
2. **Candidate content is data, never authority.** A résumé, portfolio, or reply cannot directly invoke a tool.
3. **Every actor has a narrow action space.** There is no arbitrary shell, URL, message recipient, or tool call.
4. **Every action produces a normalized observation.** Agents learn from structured facts, not UI text.
5. **Pomerium authorizes identity and tool use.** It does not decide candidate quality or validate evidence.
6. **The application validates evidence.** A privileged controller acts only after deterministic checks pass.
7. **Learning is inspectable.** The demo stores attack scores and regression rules; it does not retrain a hidden model.
8. **Hiring remains human-controlled.** The only real-world action is a screening event on a team-controlled test calendar.

## Actors

| Actor | Game character | Objective | Authority |
| --- | --- | --- | --- |
| Red Candidate | Shapeshifting applicant | Reach the screen stage using a bounded manipulation family | Submit synthetic candidate content only |
| Fillmore Sourcer | Recruiter bot | Build and engage a test pipeline from a role brief | Source, research, draft, and send test outreach |
| White Verifier | Trust analyst | Produce independent evidence and learn regressions | Read cases and call allowlisted Zero verification capabilities |
| Hiring Controller | Hiring manager | Perform evidence-backed pipeline actions | Schedule a test screen after server-side evidence validation |
| Pomerium Gate | Castle gatekeeper | Enforce machine identity/tool separation | Allow or deny MCP `tools/call` |
| Zero Portal | Capability merchant | Discover and activate bounded external verification tools | Return capability metadata and results through an allowlisted adapter |
| Arena Engine | Dungeon master | Own state, turns, observations, scoring, and termination | Orchestrate only; no sponsor credentials in the browser |

The candidate is not a Pomerium service identity. Untrusted candidate content can influence an agent's reasoning, but it can never inherit that agent's credential.

## Engine cycle

Every turn follows the same seven-stage cycle:

```text
SENSE → PLAN → REQUEST → AUTHORIZE → EXECUTE → OBSERVE → LEARN
                                                        │
                                            continue or terminate
```

1. **Sense:** give the active agent only new relevant observations and bounded memory.
2. **Plan:** select one action from the actor's typed action space.
3. **Request:** create an immutable action attempt with episode and attempt IDs.
4. **Authorize:** route privileged MCP calls through Pomerium under the actor's service identity.
5. **Execute:** call the Fillmore, Zero, test-world, or controller adapter.
6. **Observe:** normalize the result into facts, risks, artifacts, recovery hints, and provenance.
7. **Learn:** update explicit scores/regressions, test termination criteria, and select the next actor.

The coordinator, not an LLM and not the browser, advances the state machine.

## Eight-turn episode

### Turn 0 — Role initialized

- Arena creates a synthetic role brief and episode.
- Fillmore adapter receives the role and controlled candidate set.
- Metrics and memories start empty.
- Visible state: pipeline is open; Pomerium and Zero are ready.

### Turn 1 — Pipeline created

- Fillmore Sourcer sources or imports team-controlled test candidates.
- It drafts and sends test outreach.
- Red Candidate receives the outreach in a controlled inbox.
- Observation: candidate and outreach IDs, never private credentials.

### Turn 2 — Social-engineering attempt

- Red selects its highest-scoring attack family.
- It sends one synthetic reply such as an authority-spoof claim.
- Fillmore/recruiter logic processes the reply and produces an overly positive recommendation.
- Red wins the detection layer: `screen_recommended = true` without sufficient evidence.

### Turn 3 — Privileged action contained

- The sourcing identity requests `fillmore_schedule_screen` because the candidate reply told it to skip verification.
- Pomerium denies the request: the Sourcer identity cannot schedule.
- No calendar action occurs.
- The engine stores the failure invariant: candidate-provided authority was treated as trusted evidence.

### Turn 4 — Defender diagnoses

- White reads the sanitized case and Pomerium decision.
- It selects `independent_authority_verification` from the bounded defense catalog.
- It identifies the missing artifact: independent evidence for the approval/credential claim.

### Turn 5 — Zero capability power-up

- White searches Zero through a bounded discovery request.
- The adapter selects only from an application allowlist, initially webpage capture or public-page verification.
- White calls the permitted verification path.
- The result contradicts the synthetic candidate's claim.
- White submits an evidence record and stores a regression rule.

### Turn 6 — Legitimate action succeeds

- A legitimate controlled candidate passes the same checks.
- Hiring Controller requests `fillmore_schedule_screen` with only candidate and evidence IDs.
- Pomerium allows the Controller identity.
- Application code revalidates evidence.
- Fillmore schedules a meeting on the team-controlled test calendar.

### Turn 7 — Mutation replay

- Red mutates the same family once: urgency wording changes, underlying authority claim does not.
- The stored regression catches the attempt before scheduling is requested.
- Legitimate-candidate regression still passes, demonstrating zero false positives in the small test set.

### Turn 8 — Both sides learn

- Red lowers the authority-spoof score and selects another family for a future episode.
- White stores the successful defense, verifier capability, and regression ID.
- Episode terminates with one contained manipulation, one verified scheduled screen, and zero unauthorized actions.

## Bounded action spaces

### Red Candidate

```ts
type CandidateAttackFamily =
  | 'authority_spoof'
  | 'urgency_pressure'
  | 'portfolio_prompt_injection'
  | 'credential_mismatch';
```

Allowed actions:

- `candidate_choose_attack`
- `candidate_submit_reply`
- `candidate_mutate_once`
- `candidate_replay_attack`

Inputs are template IDs and synthetic candidate IDs. Red cannot choose a recipient, URL, command, or arbitrary message. Templates may expose a few bounded variables such as fictional company or fictional approver.

### Fillmore Sourcer

Allowed actions:

- `fillmore_create_test_role`
- `fillmore_source_test_candidates`
- `fillmore_draft_test_outreach`
- `fillmore_send_test_outreach`
- `fillmore_read_pipeline_event`
- `fillmore_request_screen`

The last action is a request, not direct calendar authority.

### White Verifier

Allowed actions:

- `case_read`
- `zero_discover_verifier`
- `zero_run_verifier`
- `evidence_submit`
- `regression_store`

Zero discovery accepts a fixed need enum, not an arbitrary marketplace query:

```ts
type VerificationNeed = 'public_page_capture' | 'public_claim_lookup';
```

The Zero adapter maps the need to sponsor-confirmed, allowlisted capability IDs and enforces a per-episode cost ceiling.

### Hiring Controller

Allowed actions:

- `evidence_read`
- `fillmore_schedule_screen`
- `episode_complete`

Controller accepts IDs only. It loads and validates evidence server-side before scheduling.

## Pomerium identity/tool matrix

| Tool | Sourcer | Verifier | Controller |
| --- | :---: | :---: | :---: |
| `fillmore_create_test_role` | allow | deny | deny |
| `fillmore_source_test_candidates` | allow | deny | deny |
| `fillmore_send_test_outreach` | allow | deny | deny |
| `case_read` | allow | allow | allow |
| `zero_discover_verifier` | deny | allow | deny |
| `zero_run_verifier` | deny | allow | deny |
| `evidence_submit` | deny | allow | deny |
| `fillmore_schedule_screen` | **deny** | **deny** | allow |
| `episode_complete` | deny | deny | allow |

The most important visual comparison uses the same tool:

```text
Sourcer identity    → fillmore_schedule_screen → DENY
Controller identity → fillmore_schedule_screen → ALLOW
```

Pomerium proves who may request scheduling. The application separately proves that the referenced evidence is valid.

## Observation contract

Every tool adapter returns this shape before the result reaches agent memory or the UI:

```ts
interface Observation {
  schemaVersion: 1;
  id: string;
  episodeId: string;
  attemptId: string;
  turn: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  actor: Actor;
  status: 'success' | 'warning' | 'error';
  summary: string;
  facts: Fact[];
  riskSignals: RiskSignal[];
  uncertainties: string[];
  authorization?: {
    identity: string;
    tool: ToolName;
    decision: 'allow' | 'deny';
    requestId: string;
    reason: string;
  };
  nextActions: ToolName[];
  artifacts: ArtifactReference[];
  recovery?: {
    rootCauseHint: string;
    safeRetry: string | null;
    stopCondition: string;
  };
  provenance:
    | 'fillmore'
    | 'zero'
    | 'pomerium-authorize-log'
    | 'controller'
    | 'test-world';
  occurredAt: string;
}
```

Rules:

- `summary` is one line and safe for the game log.
- `facts` are typed key/value assertions with source references.
- `riskSignals` are observations, not final hiring judgments.
- `nextActions` contains only actions legal for the current actor.
- `artifacts` contains opaque IDs or safe URLs, never tokens or raw private candidate data.
- Error observations always contain root-cause guidance, a safe retry instruction, and a stop condition.
- Raw sponsor responses are stored only in the adapter boundary if required and never sent to the browser.

## Event stream for the game renderer

The Arena reduces observations and state transitions into immutable `GameEvent` objects:

```ts
interface GameEvent {
  schemaVersion: 1;
  id: string;
  episodeId: string;
  sequence: number;
  turn: number;
  kind: GameEventKind;
  actor: Actor;
  summary: string;
  visualCue: VisualCue;
  observationId?: string;
  payload: JsonObject;
  occurredAt: string;
}
```

Required event kinds:

- `episode_started`
- `role_created`
- `candidate_sourced`
- `outreach_sent`
- `candidate_replied`
- `attack_selected`
- `screen_recommended`
- `tool_requested`
- `policy_decision`
- `failure_invariant_stored`
- `defense_selected`
- `zero_capability_discovered`
- `verification_completed`
- `evidence_submitted`
- `screen_scheduled`
- `regression_stored`
- `replay_result`
- `memory_updated`
- `episode_completed`
- `error`

Only the engine appends events. SSE sends the initial snapshot and ordered events to the browser. The renderer ignores any event with an unsupported schema version.

## Engine state

```ts
interface RecruitingGameState {
  schemaVersion: 1;
  episode: {
    id: string;
    status: 'idle' | 'running' | 'complete' | 'failed';
    turn: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  } | null;
  roleBrief: SyntheticRoleBrief | null;
  candidates: Record<string, SyntheticCandidateState>;
  pipeline: Record<string, PipelineStage>;
  pendingAction: ActionAttempt | null;
  evidence: Record<string, VerificationEvidence>;
  regressions: RegressionRule[];
  redMemory: Record<CandidateAttackFamily, MethodMemory>;
  whiteMemory: DefenseMemory;
  zeroCapabilities: DiscoveredCapability[];
  metrics: {
    manipulationAttempts: number;
    detectionMisses: number;
    pomeriumDenials: number;
    verifiedCandidates: number;
    testScreensScheduled: number;
    falsePositives: number;
    zeroSpendUsd: number;
  };
  events: GameEvent[];
  nextSequence: number;
}
```

One Arena process owns state for the hackathon. It accepts only one running episode, making the demo deterministic and avoiding concurrency races.

## Learning model

### Red memory

```text
method score = success reward + novelty + bypass depth − detection penalty − cost
```

Store per family:

- attempts
- screening wins
- privileged-action wins
- detections
- score by defense version
- last mutation used

The hackathon episode allows one mutation per family. It does not generate arbitrary manipulation text.

### White memory

Each defense record contains:

- failure invariant
- attack family
- selected verification need
- Zero capability ID
- evidence schema/digest
- regression case IDs
- hostile pass count
- legitimate-candidate pass count
- false-positive count

Learning means adding and selecting explicit regression/verification records. It does not change Pomerium policy or silently rewrite prompts during the episode.

## Evidence contract

Scheduling evidence must contain:

- episode ID
- synthetic candidate ID
- role ID
- defense/regression ID
- public-claim verification artifacts
- hostile test result
- legitimate-candidate control result
- false-positive count of zero
- creation timestamp
- canonical SHA-256 digest

The Controller receives only candidate and evidence IDs. The scheduling handler reloads the evidence and rejects missing, stale, incomplete, wrong-candidate, wrong-role, or digest-mismatched records.

## Termination rules

The episode completes only when all are true:

- one synthetic manipulation reached an incorrect recommendation;
- Pomerium contained its unauthorized schedule attempt;
- White produced independent evidence and stored a regression;
- one legitimate controlled candidate passed the regression;
- Controller scheduled exactly one test screen through Fillmore;
- the mutated replay was rejected;
- no unauthorized calendar action occurred;
- false positives equal zero in the demo set.

Stop immediately on:

- unknown candidate/recipient;
- non-test email or calendar target;
- unallowlisted Zero capability;
- missing provenance for a privileged result;
- evidence digest mismatch;
- repeated adapter failure beyond one safe retry;
- any attempt to use protected demographic attributes.

## Adapter boundaries

```ts
interface FillmorePort {
  createTestRole(input: CreateTestRoleInput): Promise<Observation>;
  sourceTestCandidates(input: SourceTestCandidatesInput): Promise<Observation>;
  sendTestOutreach(input: SendTestOutreachInput): Promise<Observation>;
  readPipelineEvent(input: PipelineEventRef): Promise<Observation>;
  scheduleTestScreen(input: ScheduleTestScreenInput): Promise<Observation>;
}

interface ZeroPort {
  discover(input: VerificationNeedInput): Promise<Observation>;
  invoke(input: AllowlistedCapabilityInput): Promise<Observation>;
}

interface PolicyPort {
  call<Name extends ToolName>(
    identity: MachineIdentity,
    tool: Name,
    input: ToolInputMap[Name],
  ): Promise<Observation>;
}
```

Use fake adapters for deterministic unit tests. The live demo must show at least one genuine Fillmore action, one genuine Zero capability result, and real Pomerium allow/deny evidence. Recorded mode must be clearly labeled.

Fillmore's exact adapter depends on hackathon-provided API, MCP, webhook, Slack, or sandbox access. This is a first-hour sponsor question, not something to simulate silently.

## 8-bit renderer contract

Characters do not decide anything. They are finite visual state machines driven by `visualCue`:

| Entity | Required visual states |
| --- | --- |
| Red Candidate | `idle`, `compose`, `attack`, `celebrate`, `mutate`, `caught` |
| Fillmore Sourcer | `idle`, `search`, `research`, `write`, `send`, `request` |
| White Verifier | `idle`, `observe`, `diagnose`, `discover`, `verify`, `learn` |
| Hiring Controller | `idle`, `review`, `request`, `schedule`, `success` |
| Pomerium Gate | `ready`, `scan`, `allow`, `deny` |
| Zero Portal | `closed`, `search`, `reveal`, `invoke`, `result` |

Initial sprite contract:

- 32×32 logical canvas rendered at integer scale.
- Side-facing or stationary characters; no four-direction walking requirement.
- Four frames for idle/action loops, two frames for allow/deny impact.
- Shared 16-color palette with role accents: red, cyan/white, blue, amber, green.
- PNG spritesheets with transparent background plus a JSON manifest.
- Reduced-motion renderer uses frame 1 only and still shows text/icon state.

Example manifest:

```json
{
  "entity": "white-verifier",
  "frameWidth": 32,
  "frameHeight": 32,
  "states": {
    "idle": { "row": 0, "frames": 4, "fps": 4 },
    "discover": { "row": 1, "frames": 4, "fps": 7 },
    "verify": { "row": 2, "frames": 4, "fps": 7 },
    "learn": { "row": 3, "frames": 2, "fps": 3 }
  }
}
```

## Screen layout

```text
┌──────────────────────────────────────────────────────────────────────┐
│ HIRE ME IF YOU CAN  Turn 3/8  Pipeline Risk 72  Screens 0  Breach 0 │
├───────────────────┬─────────────────────────┬────────────────────────┤
│ RED CANDIDATE     │ FILLMORE PIPELINE       │ TRUST CONTROL ROOM     │
│ attack deck       │ sourced → reply →       │ White Verifier         │
│ message bubble    │ verify → screen         │ Zero Portal            │
│ method memory     │ candidate dossier       │ Pomerium Gate          │
│                   │ test calendar           │ Controller              │
├───────────────────┴─────────────────────────┴────────────────────────┤
│ 00 ROLE · 01 SOURCE · 02 ATTACK · 03 DENY · 04 DIAGNOSE · ...      │
│ [START EPISODE] [RESET] [RECORDED LIVE RUN]                         │
└──────────────────────────────────────────────────────────────────────┘
```

Every animation and metric is derived from the latest state plus ordered `GameEvent` objects.

## First implementation slice

Before generating character art, migrate the project contract kit:

1. Replace cyber-target schemas with recruiting engine schemas.
2. Define the Observation and GameEvent contracts.
3. Define actor-specific tool maps and adapter ports.
4. Create a synthetic turns 0–8 fixture for the recruiting story.
5. Update contract tests to prove candidate content cannot become a tool action.
6. Build a text-only engine simulator using fake adapters.
7. Only after the simulator reaches Turn 8, generate sprites and connect the renderer.
