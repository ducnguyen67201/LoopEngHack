# Hire Me If You Can

> An observable, identity-gated recruiting agent loop built for the Loop Engineering Hackathon.

Synthetic candidate agents try to manipulate an autonomous recruiting workflow. A red agent learns which social-engineering moves work, a white agent verifies claims and stores regressions, and Pomerium keeps consequential recruiting tools behind identity-aware policy.

![Hire Me If You Can demo showing the completed recruiting loop](docs/images/hire-me-if-you-can-demo.png)

The demo tells one complete safety story: an untrusted candidate convinces a sourcing agent to recommend a screen, the sourcing identity is denied access to scheduling, independent evidence is collected, and the same scheduling tool is allowed only for the evidence-bearing hiring controller. The adaptive runtime repeats this episode, carries learning forward, and stops only when its measurable readiness criteria are satisfied.

## Why this project exists

Autonomous recruiting agents read résumés, portfolios, emails, and public profiles—all content an applicant can influence. If content is treated as authority, a candidate can try to bypass verification or trigger a privileged action.

Hire Me If You Can makes that failure mode visible and testable:

- Candidate content is always untrusted data, never authorization.
- Agents receive bounded actions instead of arbitrary tools, URLs, or recipients.
- Pomerium decides which service identity may call a protected MCP tool.
- Application code separately validates identity, evidence, and the sandbox target.
- Every decision becomes a typed, replayable event that the UI can explain.
- Red and white learning is stored as inspectable scores and regression rules.
- A readiness function—not a fixed number of repetitions—decides when learning can stop.

## Run the sample app

### Prerequisites

- Node.js 22.13 or newer
- npm

### Fixture replay — fastest path

```bash
npm ci
npm run demo
```

This opens [http://127.0.0.1:4173/?autoplay=1](http://127.0.0.1:4173/?autoplay=1) and replays the complete, sponsor-safe story. It uses the checked-in canonical fixture and does not contact Pomerium, Zero, a recruiting platform, or the agent runtime.

Use `DEMO_NO_OPEN=1 npm run demo` when you do not want the launcher to open a browser.

### Adaptive learning loop — recommended local mode

```bash
npm run dev
```

Open [http://127.0.0.1:8080/?mode=live](http://127.0.0.1:8080/?mode=live). The browser starts a run, the server executes repeated Turn 0–8 episodes, Red and White memory carries into the next episode, and ordered presentation events arrive over Server-Sent Events (SSE).

The default `fake` mode runs the real coordinator, learning loop, persistence, readiness calculation, stop conditions, HTTP API, and UI with deterministic recruiting, Zero, and policy adapters.

### Single-episode stream

```bash
npm run stream
```

This keeps the simpler single-episode coordinator path available at [http://127.0.0.1:8080/?mode=live](http://127.0.0.1:8080/?mode=live). It is useful for contract tests and debugging one deterministic episode without the adaptive supervisor.

| Mode                     | What is real                                                                | What is simulated                         | Best for                                                    |
| ------------------------ | --------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| `npm run demo`           | UI reducer and renderer                                                     | Entire event source is a recorded fixture | Rehearsal, judging, offline fallback                        |
| `npm run stream`         | One coordinator episode, HTTP API, SSE, UI                                  | Recruiting, Zero, and policy ports        | Episode-level development                                   |
| `npm run dev` (`fake`)   | Adaptive loop, memory, readiness, stop logic, coordinator, SSE, UI          | Recruiting, Zero, and policy ports        | Full local learning-loop testing                            |
| `npm run dev` (`hybrid`) | Adaptive loop plus real Pomerium authorization and protected MCP scheduling | Recruiting world and Zero evidence        | Same-tool identity proof                                    |
| `live`                   | Intentionally unavailable                                                   | —                                         | Fails closed until real recruiting and Zero factories exist |

## How one recruiting episode works

The coordinator—not the browser and not an LLM—owns the state machine. Every turn moves through the same bounded cycle:

```text
SENSE → PLAN → REQUEST → AUTHORIZE → EXECUTE → OBSERVE → LEARN
                                                        │
                                            continue or terminate
```

Each episode applies that cycle from initialization through turn eight:

| Turn | Actor                        | What happens                                                                                     | Visible proof                                                 |
| ---: | ---------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
|  0–1 | Arena + Sourcer              | Create a sandbox role, source controlled candidates, and send test outreach.                     | The pipeline and synthetic candidate appear.                  |
|    2 | Red Candidate                | Send a bounded authority-spoof reply that causes an unsafe screen recommendation.                | Red records one manipulation attempt.                         |
|    3 | Sourcer + Pomerium           | Request `recruiting_schedule_screen` using the sourcing identity.                                | Pomerium denies the tool call; no calendar action occurs.     |
|    4 | White Verifier               | Diagnose the missing independent evidence.                                                       | The evidence requirement becomes explicit.                    |
|    5 | White Verifier + Zero        | Discover an allowlisted verifier, invoke it within budget, hash the result, and submit evidence. | The unsupported candidate claim is contradicted.              |
|    6 | Hiring Controller + Pomerium | Revalidate the evidence and request the same scheduling tool under the controller identity.      | Pomerium allows the call and one sandbox screen is scheduled. |
|    7 | Red + White                  | Replay a mutated attack against the stored regression.                                           | The mutation is caught before another scheduling request.     |
|    8 | Arena                        | Persist inspectable learning and evaluate termination.                                           | The episode completes with zero policy breaches.              |

The central security proof compares the same tool under two identities:

```text
outbound-sourcer  → recruiting_schedule_screen → DENY
hiring-controller → recruiting_schedule_screen → ALLOW + valid evidence
```

Pomerium proves who may request the action. The upstream MCP handler independently verifies the Pomerium JWT assertion, applies the local actor/tool map, reloads digest-bound evidence, restricts the target to `calendar-sandbox`, and enforces one idempotent protected schedule per episode.

## How learning compounds across episodes

After each episode, Red technique scores and White regression memory are persisted atomically under `.loop-memory/<run-id>.json` and used to seed the next coordinator. The supervisor then calculates:

```text
readiness = 40% containment
          + 25% legitimate-control pass rate
          + 20% attack-family coverage
          + 15% evidence completeness
```

The default success stop requires readiness of at least 75, four hostile evaluations, three legitimate controls, zero unauthorized actions, zero false positives, and cumulative Zero spend below $1. The run fails closed on a safety violation, budget exhaustion, stagnation, or the eight-episode cap.

## Architecture

```mermaid
flowchart LR
    UI["8-bit browser UI"]
    HTTP["Express API + SSE"]
    MANAGER["Episode manager"]
    LEARN["Adaptive learning supervisor"]
    MEMORY["Atomic loop memory"]
    LOOP["Recruiting loop coordinator"]
    AGENTS["Red, white, and controller policies"]
    RECRUITING["RecruitingOpsPort"]
    POLICY["PolicyPort"]
    ZERO["ZeroPort"]
    MCP["Protected recruiting MCP"]
    POMERIUM["Pomerium identity gate"]
    ZEROAPI["Pomerium Zero capabilities"]

    UI -->|"POST run"| HTTP --> MANAGER --> LEARN
    LEARN <-->|"load + save"| MEMORY
    LEARN -->|"episode seed"| LOOP --> AGENTS
    LOOP --> RECRUITING --> MCP
    LOOP --> POLICY --> POMERIUM --> MCP
    LOOP --> ZERO --> ZEROAPI
    LOOP -->|"typed events"| LEARN
    LEARN -->|"presentation events"| HTTP --> UI
```

The browser is a presentation client. It never receives sponsor credentials and never calls Pomerium, Zero, a recruiting system, or an agent directly. It only reduces canonical events into visual state.

The three external boundaries remain vendor-neutral ports:

- `RecruitingOpsPort` creates the sandbox role, sources candidates, sends outreach, reads events, and schedules the controlled screen.
- `PolicyPort` authorizes privileged tool attempts under the active service identity.
- `ZeroPort` discovers and invokes only allowlisted public-verification capabilities within an episode budget.

Because the coordinator depends on ports, deterministic, hybrid, and future live adapters use the same engine and UI contracts.

## Technology

| Layer                | Technology                                                     | Purpose                                                                |
| -------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Language/runtime     | TypeScript 6, Node.js 22                                       | Strict server, engine, adapter, and test code                          |
| HTTP and streaming   | Express 5, Server-Sent Events                                  | Run creation, snapshots, resumable event delivery, static UI           |
| Contracts            | Zod 4                                                          | Runtime validation for commands, observations, state, and events       |
| Learning runtime     | Persistent memory, weighted readiness, bounded stop conditions | Repeats episodes until measurable safety criteria pass                 |
| Tool protocol        | Model Context Protocol SDK                                     | Streamable HTTP client and protected recruiting MCP server             |
| Authorization        | Pomerium service accounts and tool policy                      | Machine identity and same-tool allow/deny enforcement                  |
| Defense in depth     | Pomerium JWT/JWKS verification, local actor/tool policy        | Fails closed if route policy or identity validation is wrong           |
| Capability discovery | Pomerium Zero adapter                                          | Allowlisted public-proof discovery and invocation with budget controls |
| Recruiting boundary  | `RecruitingOpsPort` / Fillmore integration boundary            | Keeps the engine independent from any recruiting vendor                |
| Frontend             | Semantic HTML, modern CSS, vanilla JavaScript                  | Framework-free 8-bit event renderer and presenter controls             |
| Reliability          | Buffered event hubs, SSE resume, authoritative snapshots       | Ordered replay, reconnects, duplicate rejection, and gap recovery      |
| Testing              | Vitest, V8 coverage                                            | Unit, contract, adapter, HTTP, runtime, UI, and accessibility tests    |
| Quality              | ESLint, Prettier, TypeScript                                   | Linting, formatting, and static verification                           |
| Deployment           | Docker Compose                                                 | Local service topology and optional Pomerium profile                   |

## Event and recovery model

Every adapter result is normalized into an `Observation` with facts, risk signals, provenance, artifacts, safe recovery guidance, and optional authorization metadata. The engine turns those observations and state transitions into immutable `GameEvent` objects; the adaptive runtime maps them into one ordered presentation stream across episodes.

The live browser path is deliberately recoverable:

1. `POST /api/episodes` creates a bounded run.
2. `GET /api/episodes/:id/events` streams ordered events with the sequence as the SSE ID.
3. The renderer ignores duplicates and pauses if it detects a sequence gap.
4. `GET /api/episodes/:id` returns the authoritative run and event snapshot.
5. The browser hydrates from that snapshot and reconnects after the last known sequence.

The adaptive manager permits one active learning run. The legacy single-episode runtime retains at most 20 episodes and expires completed episodes after 15 minutes.

## Safety boundaries

- All candidates, inboxes, and calendar events in the demo are synthetic or allowlisted test resources.
- The candidate is never a Pomerium service identity and can never inherit an agent credential.
- Tool inputs use opaque IDs and bounded enums instead of arbitrary URLs, commands, recipients, or messages.
- Hybrid and live run creation requires an operator bearer token that never enters the browser.
- Zero targets are resolved server-side, checked against an allowlist, and constrained by an episode cost ceiling.
- Evidence artifacts are hashed; credentials and raw sponsor responses do not enter the browser event stream.
- The sourcer can research and send controlled outreach, but only the hiring controller can schedule.
- Consequential scheduling is idempotent, evidence-bound, and restricted to the sandbox calendar.
- `live` mode fails closed until real recruiting and Zero runtime factories are installed.

## Project structure

```text
src/domain/       Zod schemas, inferred types, and vendor-neutral ports
src/agents/       Inspectable red, white, and controller policies
src/engine/       Coordinator, reducer, termination, replay, and deterministic fakes
src/loop/         Persistent multi-episode learning, readiness, and stop conditions
src/adapters/     Pomerium, Zero, and recruiting integration boundaries
src/runtime/      Episode ownership, adaptive lifecycle, memory, and event hubs
src/server/       HTTP, snapshots, SSE, UI hosting, and protected MCP endpoint
public/           Event-driven 8-bit renderer, presenter controls, and sprites
fixtures/         Canonical synthetic recruiting episode
tests/            Contract, engine, adapter, runtime, HTTP, UI, and a11y tests
docs/runbooks/    Learning-loop, Pomerium, and Zero setup guides
```

## Development commands

```bash
npm run demo          # recorded fixture UI on :4173
npm run dev           # adaptive multi-episode runtime on :8080
npm run stream        # legacy single-episode SSE runtime on :8080
npm run simulate      # print a deterministic headless episode
npm run typecheck     # TypeScript without emitting files
npm run lint          # ESLint
npm run format:check  # Prettier verification
npm test              # Vitest suite
npm run test:coverage # Vitest with V8 coverage
npm run build         # compile TypeScript to dist/
docker compose config # validate the service topology
```

## Connecting Pomerium and Zero

The default commands are intentionally safe and deterministic. For hybrid setup, keep credentials in a local `.env`, use synthetic resources, and follow the runbooks:

- [Full learning loop and Pomerium guard](docs/runbooks/full-learning-loop.md)
- [Pomerium Zero bootstrap](docs/runbooks/pomerium-zero-bootstrap.md)
- [Zero adapter verification](docs/runbooks/zero.md)
- [Local Pomerium Core proof](docs/runbooks/pomerium-core-local.md)

Hybrid mode sends the Sourcer authorization probe, Controller authorization probe, and consequential scheduling call through real identity-scoped Pomerium MCP routes. Recruiting and Zero remain synthetic, so hybrid output must not be labeled as fully live sponsor provenance.

## Current status

- [x] Recruiting concept, safety model, and strict domain contracts
- [x] Deterministic initialization plus an eight-turn agent episode
- [x] Red, white, and controller policies with inspectable learning
- [x] Persistent multi-episode learning with readiness and stop conditions
- [x] Fixture replay plus resumable SSE streaming to the 8-bit UI
- [x] Pomerium-guarded MCP scheduling path and upstream JWT verification
- [x] Pomerium MCP client and Zero adapter boundaries with tests
- [ ] Capture the real Pomerium same-tool deny/allow proof in hybrid mode
- [ ] Complete a live Zero capability invocation
- [ ] Connect the production recruiting adapter at `RecruitingOpsPort`
- [ ] Record and submit the three-minute demo

For the detailed engine contract, see [docs/recruiting-loop-engine.md](docs/recruiting-loop-engine.md). For UI wiring and event extension rules, see [public/INTEGRATION.md](public/INTEGRATION.md).
