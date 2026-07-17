# PRP: Recruiting Pipeline Runtime and Integration

## Purpose

Wire the frozen engine, sponsor adapters, Pomerium-fronted MCP tool, and 8-bit renderer into one reproducible pipeline. This branch can build the runtime shell against fake ports concurrently with the adapters, then becomes the sole merge target for their completed branches.

## Branch and ownership

- Branch: `codex/recruiting-pipeline`
- Base: frozen recruiting-contract SHA.
- Owns: `src/runtime/**`, `src/server/**`, `src/main.ts`, `src/config.ts`, `compose.yaml`, `.env.example`, `package.json`, `package-lock.json`, integration/E2E tests, container build files.
- Receives merges from: Pomerium, Zero, Fillmore, UI branches.
- Must not rewrite: frozen `src/domain/**` or adapter internals during ordinary wiring.

## Runtime topology

```text
Browser (8-bit UI)
   <- snapshot + SSE GameEvent stream
Arena HTTP server
   -> Coordinator / engine
      -> FillmorePort
      -> ZeroPort
      -> PolicyPort

Hiring controller or sourcer
   -> Pomerium protected MCP route
      -> Recruiting MCP server
         -> fillmore_schedule_screen handler
            -> Fillmore adapter -> sandbox operation
```

Pomerium must be on the actual network path to the schedule tool. Calling `PolicyPort.authorize` and then bypassing Pomerium with a direct Fillmore call is not sufficient for the sponsor proof.

## Runtime modes

Implement explicit factories:

- `fake`: deterministic core fakes, no credentials/network.
- `recorded`: sanitized real observations loaded from committed/captured fixtures.
- `live`: Pomerium, Zero, and Fillmore startup probes are mandatory; any selected live adapter failure exits non-zero.

Support per-adapter status for honest degraded demos, but do not silently relabel a recorded adapter as live. The overall UI badge should show `live`, `hybrid`, `recorded`, or `fake` based on actual adapter states.

## Files

- `src/runtime/adapter-factory.ts`: selects fake/recorded/live implementations.
- `src/runtime/episode-runner.ts`: invokes coordinator, handles cancellation and one active episode.
- `src/runtime/recording.ts`: writes/reads sanitized observations with hashes.
- `src/runtime/startup-probes.ts`: bounded sponsor health/capability checks.
- `src/runtime/shutdown.ts`: drains events and closes clients.
- `src/server/http.ts`: Express server and static UI hosting.
- `src/server/routes/episode.ts`: start/status/snapshot endpoints.
- `src/server/routes/events.ts`: SSE with sequence resume.
- `src/server/mcp.ts`: Streamable HTTP MCP server exposing recruiting tools.
- `src/server/health.ts`: readiness/liveness and adapter mode state.
- `src/server/redaction.ts`: last-resort response/log redaction.
- `src/main.ts`: small composition root only.
- `src/config.ts`: strict environment parsing and cross-field validation.
- `compose.yaml`: arena, recruiting MCP server, Pomerium, and any safe local fixtures.
- `Dockerfile`: reproducible Node runtime.
- `tests/integration/**`, `tests/e2e/**`.

## HTTP surface

Keep the surface narrow:

- `GET /health/live`
- `GET /health/ready`
- `POST /api/episodes` creates a new sandbox episode; reject if one is already active.
- `GET /api/episodes/:id` returns safe snapshot and current sequence.
- `GET /api/episodes/:id/events` streams SSE and accepts `Last-Event-ID`.
- `POST /api/episodes/:id/cancel` cancels before the next side effect.
- `POST /mcp` (or SDK-required Streamable HTTP route) exposes strict recruiting MCP tools behind Pomerium.

No endpoint accepts arbitrary shell commands, URLs, actor identities, or tool names from the browser.

## MCP server

Expose exact frozen names and strict inputs. At minimum:

- safe read/diagnostic tools;
- `fillmore_schedule_screen` with episode, candidate, test calendar, evidence hash, and idempotency key.

The handler must:

1. trust identity supplied by Pomerium’s verified context, not the JSON body;
2. validate input with frozen schemas;
3. require controller-approved evidence hash;
4. enforce sandbox allowlists again;
5. call `FillmorePort.scheduleScreen`;
6. return a normalized safe result.

Defense in depth here does not replace the external Pomerium deny/allow policy.

## Configuration

Extend the existing strict `src/config.ts` pattern. Blank values normalize to absent. Never log parsed secrets.

Groups:

- runtime: port, mode, recording directory, timeouts, event buffer;
- demo: sandbox workspace, synthetic role/candidate IDs, email sink, calendar/attendee allowlist;
- Pomerium: route URL, pinned image, service-account secret paths/tokens, authorize-log source;
- Zero: selected official transport, executable/endpoint, auth/config path, allowed domains, per-call and episode budget;
- Fillmore: official transport, endpoint/workspace, secret, resource allowlists;
- presentation: autoplay speed and default fixture only.

Use secret files/mounts where possible. `.env.example` contains placeholders only.

## Concurrent shell work

Before adapter branches finish, implement and test:

- HTTP/SSE server;
- fake adapter factory;
- episode lifecycle;
- recording/replay format;
- strict config shape with placeholder adapter blocks;
- MCP server against fake Fillmore;
- static UI serving after UI merge;
- integration tests against fake ports.

Do not write temporary “real” implementations inside `src/runtime/**`; wait for the adapter merges.

## Adapter merge sequence

```bash
git merge --no-ff codex/pomerium-adapter
npm run typecheck && npm test
git merge --no-ff codex/zero-adapter
npm run typecheck && npm test
git merge --no-ff codex/fillmore-adapter
npm run typecheck && npm test
git merge --no-ff codex/recruiting-game-ui
npm run typecheck && npm test
```

After each merge, add only composition/configuration code owned by this branch. If an adapter does not implement the frozen port, fix it on its own branch or update the core contract once and rebase all siblings.

## End-to-end episode wiring

1. `POST /api/episodes` seeds synthetic role/candidate state.
2. Runner advances engine and publishes ordered events.
3. Fillmore adapter creates/reads the sandbox pipeline event.
4. Sourcer calls `fillmore_schedule_screen` through Pomerium and is denied.
5. Coordinator records Pomerium observation and asks white policy for recovery.
6. Zero adapter discovers then invokes verification; evidence artifact is hashed.
7. Controller validates provenance/hash/regression.
8. Controller calls the identical Pomerium-protected tool and is allowed.
9. MCP handler calls Fillmore adapter with idempotency key; sandbox event ID returns.
10. Engine replays mutation, stores both memories, and emits terminal event.

## Recording and demo resilience

After one successful live run, capture a sanitized recording:

- only normalized observations and events;
- content-addressed artifact metadata, not raw candidate content;
- no credentials, headers, cookies, internal URLs, or sensitive tool parameters;
- manifest containing adapter versions/modes and SHA-256 hashes.

Recorded mode replays timing and events but displays a persistent `RECORDED` badge. It is a demo backup, not evidence of live operation.

## Edge cases

- One active episode prevents duplicate external actions.
- Process restart reloads snapshot/recording metadata or marks the prior episode interrupted; it does not blindly repeat scheduling.
- SSE reconnect resumes by global sequence.
- Backpressure uses a bounded event buffer and snapshot recovery.
- Pomerium deny is expected and advances recovery.
- Pomerium allows but Fillmore fails: episode remains incomplete and may reconcile once by idempotency key.
- Zero budget exhaustion ends safely before schedule.
- Client disconnect never cancels the engine implicitly.
- Shutdown stops before new actions, waits for in-flight safe operations, and records uncertain outcomes.
- Any live adapter probe failure is visible in readiness and the UI mode.

## Tests

### Integration

- fake episode produces the golden event sequence and terminal state;
- runtime factory never silently falls back;
- SSE resume and snapshot recovery work;
- one active episode and idempotency prevent duplicate screens;
- MCP handler derives identity from verified context and ignores body impersonation;
- controller evidence hash is required;
- configuration rejects unsafe live combinations and blank/invalid secrets;
- recordings pass recursive secret/PII scanning and hash validation.

### Compose/local live

- Pomerium routes to the Streamable HTTP MCP server;
- sourcer call is denied before upstream tool execution;
- controller call is allowed and reaches handler once;
- Zero invocation returns capability/invocation provenance;
- Fillmore creates/reconciles one sandbox event;
- UI receives every event in order and reaches the expected final state.

### Browser E2E

- start episode, observe deny, discovery, allow, scheduled event, replay block, learn;
- provenance drawer contains correlated safe IDs;
- fake/recorded/live/hybrid badge is accurate;
- reconnect mid-episode produces no duplicated animation/outcome.

## Validation

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
docker compose config
docker compose up --build --wait
```

Run credential-gated sponsor smoke tests separately. Never place their output containing secrets into committed logs.

## Three-minute rehearsal target

- 0:00–0:20: objective and identities.
- 0:20–0:50: candidate manipulation enters Fillmore pipeline.
- 0:50–1:15: sourcer hits the Pomerium gate; same tool denied.
- 1:15–1:50: white verifier asks Zero, discovers capability, obtains evidence.
- 1:50–2:20: controller calls same tool; Pomerium allows; Fillmore schedules sandbox screen.
- 2:20–2:45: mutated replay is blocked and memory changes are shown.
- 2:45–3:00: proof drawer: Pomerium request IDs, Zero invocation ID, Fillmore operation ID.

## Acceptance criteria

- Clean fake mode requires no credentials and is deterministic.
- Live mode fails closed and produces real sponsor provenance.
- Pomerium is physically on the schedule-tool network path.
- The exact same MCP tool is denied for sourcer and allowed for controller.
- Zero discovers/invokes a capability under a bounded budget.
- Fillmore makes exactly one sandbox recruiting side effect.
- One monotonic event stream drives the UI from Turn 0 through Turn 8.
- Recorded fallback is sanitized, hash-verified, and honestly labeled.
- No real candidate, real hiring decision, or production calendar is touched.
