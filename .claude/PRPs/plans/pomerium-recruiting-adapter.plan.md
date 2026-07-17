# PRP: Pomerium Identity-Aware MCP Gate

## Purpose

Implement the judge-visible authorization boundary: the Fillmore sourcer identity is denied access to `fillmore_schedule_screen`, while the hiring controller identity is allowed to call that exact same MCP tool after evidence is validated.

## Branch and ownership

- Branch: `codex/pomerium-adapter`
- Base: frozen recruiting-contract SHA.
- Owns: `src/adapters/pomerium/**`, `config/pomerium/**`, `scripts/verify-pomerium.ts`, `tests/adapters/pomerium/**`, `docs/runbooks/pomerium.md`.
- Must not edit: `src/domain/**`, `src/config.ts`, `src/main.ts`, `compose.yaml`, package manifests.

## Official behavior to implement

Pomerium’s MCP route fronts an HTTP Streamable MCP server. Identity belongs in `allow`; tool restrictions belong in `deny`. The `mcp_tool` criterion is evaluated for `tools/call`, not `tools/list`, so placing tool criteria only under `allow` can break discovery.

Sources:

- https://www.pomerium.com/docs/capabilities/mcp/protect-mcp-server
- https://www.pomerium.com/docs/capabilities/mcp/limit-mcp-tools
- https://www.pomerium.com/docs/capabilities/service-accounts

MCP support is currently documented as experimental on Pomerium `main`. Pin a sponsor-confirmed image digest that has passed the smoke test; never use a moving `main` tag during judging.

## Policy design

Expose the same upstream recruiting MCP server through identity-specific routes or policies. The proof must be attributable to authenticated service-account identity, not a caller-supplied JSON `actor` field.

Required matrix:

| Authenticated identity | Tool | Expected |
| --- | --- | --- |
| Fillmore sourcer | create/source/outreach/read tools | allow |
| Fillmore sourcer | `fillmore_schedule_screen` | deny |
| White verifier | Zero/evidence tools on its route | allow as configured |
| Hiring controller | `fillmore_schedule_screen` | allow |
| Unknown/expired identity | any protected tool | deny |

Prefer deny allowlists using `mcp_tool.not_in` for each identity route/policy. Keep non-tool MCP methods available for connection/session negotiation.

## Adapter responsibilities

Implement the frozen `PolicyPort` and normalize authorization proof into `Observation`:

- accept actor identity, exact MCP tool name, request/attempt IDs, and safe metadata;
- select the correct service-account credential from injected configuration;
- make the real request through Pomerium using the supported MCP client transport;
- correlate response with Pomerium `x-request-id`/authorize log request ID;
- classify allow/deny without throwing on an expected denial;
- emit reason codes and sanitized provenance;
- never emit JWTs, cookies, authorization headers, or raw sensitive tool parameters.

Do not duplicate controller evidence validation here. Pomerium authorizes identity + tool access; it does not decide whether a candidate is qualified.

## Files

- `src/adapters/pomerium/pomerium-policy-adapter.ts`: `PolicyPort` implementation.
- `src/adapters/pomerium/mcp-client.ts`: Streamable HTTP client wrapper and credential injection.
- `src/adapters/pomerium/authorize-log.ts`: strict parser/normalizer for configured authorize fields.
- `src/adapters/pomerium/credentials.ts`: injected credential resolver with redacted diagnostics.
- `src/adapters/pomerium/errors.ts`: map HTTP/MCP failures to frozen error categories.
- `src/adapters/pomerium/index.ts`: public adapter exports only.
- `config/pomerium/config.yaml`: pinned local-demo policy configuration with no secrets.
- `config/pomerium/policy-fixtures/*.json`: sanitized expected allow/deny log samples.
- `scripts/verify-pomerium.ts`: executable same-tool matrix check.
- `docs/runbooks/pomerium.md`: image digest, setup, service-account creation, rotation, and live proof steps.

## Configuration contract

Read configuration through constructor parameters supplied by the pipeline. Expected values:

- Pomerium route URL;
- sourcer service-account JWT;
- controller service-account JWT;
- optional verifier JWT;
- authorize-log input path/stream or correlation endpoint;
- timeout and retry budget;
- tested Pomerium image digest.

Credentials stay in environment/secret mounts. The repository contains only variable names and redacted examples.

## Authorization evidence

Configure only safe useful fields, such as:

- request ID;
- service-account/user ID;
- MCP method;
- MCP tool;
- allow/deny reason fields;
- timestamp.

Avoid logging `mcp-tool-parameters` because candidate data and tool arguments can be sensitive. The UI should receive a sanitized summary like:

```json
{
  "identity": "fillmore-sourcer",
  "tool": "fillmore_schedule_screen",
  "decision": "deny",
  "reasonCodes": ["mcp-tool-unauthorized"],
  "requestId": "req-demo-003"
}
```

## Implementation tasks

1. Confirm the exact sponsor-provided Pomerium image/tag and record its digest.
2. Stand up a minimal Streamable HTTP MCP fixture outside this adapter or use the pipeline’s test server.
3. Write Pomerium route policy with identity allow and tool deny rules.
4. Create separate short-lived sourcer/controller service accounts in the local demo namespace.
5. Implement credential injection and MCP request correlation.
6. Implement authorize-log parsing with strict schemas and aggressive redaction.
7. Implement `PolicyPort` normalization for allow, deny, timeout, upstream failure, and malformed log evidence.
8. Add `verify-pomerium.ts` that calls the identical tool with both identities and asserts deny/allow.
9. Add unit tests with sanitized fixtures and an integration test against the local Pomerium container.
10. Document the live setup, token rotation, troubleshooting, and demo proof capture.

## Edge cases

- `tools/list` succeeds while a forbidden `tools/call` is denied.
- A 200 HTTP response containing an MCP error is not classified as allow.
- A denied HTTP/MCP result without correlated authorize evidence is reported as incomplete proof, not fabricated policy provenance.
- Request ID mismatches fail closed.
- Expired JWT is `authorization_denied`, not an upstream retry loop.
- Network timeout retries at most once when safe; tool calls with uncertain side effects are not blindly replayed.
- Controller identity cannot be selected by untrusted candidate content.
- Log parser rejects raw authorization headers and recursively redacts token-shaped values.

## Tests

- strict parser accepts sanitized real log fixtures and rejects unknown/missing critical fields;
- credentials never appear in serialized errors, observations, snapshots, or logger output;
- sourcer + read tool = allow;
- sourcer + `fillmore_schedule_screen` = deny;
- controller + `fillmore_schedule_screen` = allow;
- exact same tool input hash is used for the deny/allow comparison;
- unknown identity = deny;
- non-tool MCP request is not accidentally blocked by `mcp_tool` policy;
- malformed/mismatched authorize evidence = `contract_violation`;
- expected denial returns an `Observation`, not a rejected promise.

## Validation

```bash
npm run typecheck
npm run lint
npm test -- tests/adapters/pomerium
npx tsx scripts/verify-pomerium.ts
```

Manual proof:

1. Open the authorization log stream.
2. Run sourcer attempt and capture the deny request ID.
3. Run controller attempt with identical tool name/input hash and capture the allow request ID.
4. Confirm the MCP tool actually reaches the upstream only for the controller.

## Acceptance criteria

- `PolicyPort` passes all frozen contract tests without domain edits.
- The local integration test demonstrates identity-aware deny/allow on the same tool.
- Authorization observations contain correlated Pomerium provenance.
- No secret or tool-parameter leakage occurs.
- The Pomerium image is pinned by digest and the runbook can reproduce the setup.

## Handoff to pipeline

Provide:

- exported adapter factory signature;
- required configuration keys (names only);
- Pomerium config directory;
- smoke-test command;
- sanitized deny/allow fixture IDs;
- tested image digest.

The pipeline owner wires these into `src/config.ts` and `compose.yaml`; this branch does not edit those files.
