# Project Structure and Contract Kit

> Status: complete
>
> Implementation report: `../../reports/project-structure-report.md`

## Summary

Create the standalone Node/TypeScript scaffold and freeze the schemas, adapter ports, service topology, environment names, and synthetic event fixture needed by all later LoopCTF PRDs.

## Patterns to Mirror

- Strict TypeScript and exact MCP/Zod versions from the local TrustLoopGuard MCP server.
- Fail-fast, non-secret-echoing environment validation from its client configuration.
- Compose service DNS and environment seams from the workspace Compose file.
- Dependency-injected ports; no target, agent, MCP, policy, or UI implementation in this slice.

## Files to Change

- package/toolchain configuration and npm lockfile
- `.env.example`, `.gitignore`, `compose.yaml`
- `src/config.ts`, `src/main.ts`
- `src/domain/types.ts`, `schemas.ts`, `ports.ts`
- `fixtures/contract-events.json`
- contract/config/composition tests

## Tasks

1. Initialize the isolated feature repository and npm toolchain.
2. Freeze service names, ports, routes, environment names, and role-specific config.
3. Implement Zod schemas and inferred TypeScript types.
4. Implement adapter ports for the parallel PRD lanes.
5. Create a synthetic turns 0–8 fixture covering every event kind.
6. Add tests proving schema safety, fake-port compilation, config requirements, and service naming.

## Validation

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
docker compose config
```

## Acceptance

- All later lanes can compile against frozen ports.
- Synthetic fixture validates and is unmistakably labeled.
- Seven bounded tool contracts accept no arbitrary command or URL.
- Service names/ports/env names are committed and Compose-valid.
- Role configuration fails fast without echoing secrets.
- All validation passes.
