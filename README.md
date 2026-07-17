# Loop Engine Hackathon

Standalone npm workspace for the LoopCTF hackathon project.

## Project

**LoopCTF** is a self-hardening web application where attacker and defender agents learn continuously, while Pomerium ensures that only verified evidence—not an agent's confidence—can change the live target.

## Working rule

All new application code, configuration, tests, deployment files, demo assets, and submission documentation for the hackathon belong in this directory.

Do not modify or copy implementation code from the sibling TrustLoopGuard, HackAgentOrchestration, or HackAgent repositories.

## Project structure

```text
src/domain/       Frozen schemas, inferred types, and adapter ports
src/              Runtime configuration and composition root
fixtures/         Synthetic contract data now; recorded-live data later
tests/            Contract, configuration, and composition tests
compose.yaml      Frozen service names, ports, and environment seams
.claude/PRPs/     Local implementation plans and reports
```

The first slice intentionally contains contracts and scaffolding only. Target behavior, agents, MCP handlers, Pomerium policy, SSE runtime, and UI are separate PRDs that plug into the ports defined here.

## Commands

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
docker compose config
```

To connect the Pomerium Zero data plane first, follow
[`docs/runbooks/pomerium-zero-bootstrap.md`](docs/runbooks/pomerium-zero-bootstrap.md).

## Current status

- [x] Concept and architecture locked
- [x] Work decomposed into two phases and small PRDs
- [x] Standalone project structure and contract kit
- [ ] Pomerium capability spike
- [ ] Phase 1 headless trust loop
- [ ] Phase 2 judge UI and provenance
- [ ] Deployment, recording, and submission
