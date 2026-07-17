# Hire Me If You Can

A Pomerium-governed autonomous outbound recruiting game for the Loop Engineering Hackathon.

## Project

Synthetic candidate agents attempt to manipulate an outbound recruiting workflow. A verifier discovers public-proof capabilities through Zero, while Pomerium ensures only the hiring-controller identity can execute consequential recruiting tools such as `recruiting_schedule_screen`.

The application uses a vendor-neutral `RecruitingOpsPort`. The hackathon implementation is a controlled local outbound pipeline; a third-party recruiting platform can be added later without changing the engine or UI.

## Safety boundary

- Candidate content is untrusted data, never authority.
- The sourcer may research, draft, and send test outreach but cannot schedule screens.
- The verifier may discover capabilities and submit evidence.
- The hiring controller may schedule only after validating hashed evidence.
- All candidates, inboxes, and calendars used by the demo are synthetic or allowlisted test resources.

## Project structure

```text
src/domain/       Strict schemas, inferred types, and vendor-neutral ports
src/agents/       Inspectable red/white learning policies
src/engine/       Coordinator, reducer, deterministic fakes, and replay logic
src/adapters/     Pomerium and Zero adapters; local outbound implementation boundary
src/runtime/      Episode ownership and buffered canonical event streams
src/server/       HTTP episode API, static UI hosting, snapshots, and SSE
fixtures/         Synthetic recruiting contract data
public/           Event-driven 8-bit renderer and original sprites
tests/            Contract, adapter, configuration, and composition tests
compose.yaml      Recruiting service topology and Pomerium data plane
```

## Commands

```bash
npm ci
npm run demo
npm run stream
npm run typecheck
npm run lint
npm test
npm run build
docker compose config
```

`npm run demo` starts the fixture-only arena at `http://127.0.0.1:4173/?autoplay=1`, opens it in
the default browser, and automatically replays the complete sponsor-safe story. Set
`DEMO_NO_OPEN=1` when running it in CI or another headless environment.

`npm run stream` starts the real coordinator with deterministic fake adapters and serves the UI at
`http://127.0.0.1:8080/?mode=live`. The browser creates an episode, receives all canonical engine
events over SSE, and can reconnect using the buffered event history.
The local runtime allows one active episode, retains at most 20 completed/running episodes for 15
minutes, and restores the renderer from an authoritative snapshot if the browser observes a gap.

To connect the Pomerium Zero data plane, follow
[`docs/runbooks/pomerium-zero-bootstrap.md`](docs/runbooks/pomerium-zero-bootstrap.md).

## Current status

- [x] Recruiting concept and architecture locked
- [x] Vendor-neutral recruiting contracts and golden event fixture
- [x] Complete deterministic headless agent loop
- [x] Stream the real coordinator into the 8-bit renderer over SSE
- [ ] Complete Pomerium same-tool deny/allow proof
- [ ] Complete Zero live capability invocation
- [ ] Complete the local outbound recruiting adapter
- [ ] Record and submit the three-minute demo
