# Pomerium Core local MCP policy test

This runbook proves that open-source Pomerium Core parses MCP traffic and blocks
or allows an individual tool call. It does not require Pomerium Zero.

The first smoke test deliberately uses two public local routes. It proves the
MCP policy boundary independently from authentication:

```text
Sourcer    -> recruiting_find_candidates   -> ALLOW
Sourcer    -> recruiting_schedule_screen   -> DENY (MCP access-denied error)
Controller -> recruiting_schedule_screen   -> ALLOW
```

It does **not** prove separate agent identities. See "Identity proof" below.

## Prerequisites

- Docker Desktop
- Node.js 22+
- Optional: `mkcert` (`brew install mkcert` on macOS) for browser-trusted TLS.
  Without it, the setup script creates a short-lived self-signed certificate
  that is sufficient for the command-line proof.

Pomerium's MCP support is currently experimental, so this test uses
`pomerium/pomerium:main` and explicitly enables `runtime_flags.mcp`.

## Run the proof

From the repository root:

```bash
npm ci
bash scripts/setup-pomerium-core.sh
```

Start the tiny internal MCP server in terminal 1:

```bash
npx tsx scripts/pomerium-core-smoke-server.ts
```

Start open-source Pomerium Core in terminal 2:

```bash
docker compose -f compose.pomerium-core.yaml up -d
docker compose -f compose.pomerium-core.yaml logs -f pomerium-core
```

Run the three assertions in terminal 3. `NODE_EXTRA_CA_CERTS` lets Node trust
the generated local CA without disabling TLS verification:

```bash
NODE_EXTRA_CA_CERTS="$PWD/.pomerium/core-ca.pem" \
  npx tsx scripts/verify-pomerium-core.ts
```

Expected result:

```text
PASS  Sourcer can call read-only recruiting_find_candidates -> HTTP 200
PASS  Sourcer cannot call recruiting_schedule_screen -> MCP access denied (blocked by Pomerium)
PASS  Controller can call identical recruiting_schedule_screen -> HTTP 200

Pomerium Core MCP policy smoke test passed.
```

The upstream server's terminal must log the safe call and the Controller call.
It must not log a Sourcer scheduling execution. Pomerium's authorization logs
should include `mcp-method`, `mcp-tool`, and the deny decision.

Pomerium represents an MCP policy denial as a JSON-RPC error (`-32602`,
`access denied`) in an HTTP 200 response. Clients should classify that protocol
error as an authorization denial instead of relying only on HTTP 401/403.

Stop the gateway with:

```bash
docker compose -f compose.pomerium-core.yaml down
```

## What this proves

- The official Pomerium Core container is running locally.
- TLS terminates at Pomerium; the MCP server remains internal HTTP.
- Pomerium understands the JSON-RPC request as `tools/call`.
- Pomerium enforces a policy on the exact MCP tool name.
- A denied consequential call never reaches the upstream tool handler.

## Identity proof

Pomerium-managed Service Accounts are a Zero/Enterprise feature, not a Core
feature. For a fully local open-source identity proof, add a local OIDC provider
such as Keycloak and enable Pomerium's direct IdP bearer-token authentication.
Issue one token for the Sourcer and another for the Controller, then combine an
identity criterion (`email` or an IdP claim) with the `mcp_tool` deny rule.

For the hackathon, use this order:

1. Get the policy smoke test green first.
2. Ask the sponsor whether they want the final demo to use Zero Service
   Accounts or Core + local Keycloak identities.
3. Keep the same MCP server, tool names, and verifier; only the route identity
   configuration and authorization headers change.
