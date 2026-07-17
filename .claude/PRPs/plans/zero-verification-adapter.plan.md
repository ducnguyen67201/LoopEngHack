# PRP: Zero Capability Discovery and Verification Adapter

## Purpose

Make the white verifier genuinely acquire a missing capability during the loop. It asks Zero for a capability that can verify a bounded public claim, selects an allowlisted result, invokes it with a spend ceiling, and returns evidence with provenance.

## Branch and ownership

- Branch: `codex/zero-adapter`
- Base: frozen recruiting-contract SHA.
- Owns: `src/adapters/zero/**`, `scripts/verify-zero.ts`, `tests/adapters/zero/**`, `docs/runbooks/zero.md`.
- Must not edit: `src/domain/**`, `src/config.ts`, `src/main.ts`, `compose.yaml`, package manifests.

## Official model

Zero describes itself as a search engine and payment layer through which agents discover and invoke capabilities. The official plugin installs a skill, hooks, and an MCP connector; the documented CLI setup is:

```bash
npm i -g @zeroxyz/cli
zero init
zero auth login
```

Source: https://github.com/officialzeroxyz/zero-plugins

Do not invent an undocumented REST endpoint. Before implementation, inspect the installed CLI/plugin and confirm the sponsor-supported non-interactive integration surface for a Node service: CLI, MCP connector, or documented API. Record exact command/tool schemas and tested versions in the runbook.

## Bounded product use

The engine provides a typed `VerificationNeed`, never a free-form shell command:

- `public_page_capture`: capture a public portfolio/company page as time-stamped evidence.
- `public_claim_lookup`: retrieve a bounded public claim from an allowlisted domain.

The adapter maps that need to a stable Zero search query, receives candidates, and selects only a capability satisfying all local policy constraints:

- intended input/output category;
- allowlisted network/data behavior;
- declared price under per-call and per-episode budget;
- structured provenance;
- no credential harvesting, messaging, employment decision, or destructive action.

The innovative behavior is runtime discovery plus selection. The adapter must not hardcode one provider ID as its only path. A cached last-known-good provider is acceptable only as an explicit recovery path and must be visible in the observation.

## Files

- `src/adapters/zero/zero-verification-adapter.ts`: implements frozen `ZeroPort`.
- `src/adapters/zero/transport.ts`: sponsor-supported CLI/MCP/API transport behind a tiny interface.
- `src/adapters/zero/discovery.ts`: stable query construction and candidate normalization.
- `src/adapters/zero/selection.ts`: deterministic allowlist, capability, price, and provenance scoring.
- `src/adapters/zero/budget.ts`: per-call/per-episode accounting in integer minor units.
- `src/adapters/zero/evidence.ts`: artifact hashing and safe evidence references.
- `src/adapters/zero/errors.ts`: map transport failures to frozen categories.
- `src/adapters/zero/index.ts`: public exports.
- `scripts/verify-zero.ts`: live discovery/invocation smoke test against synthetic public input.
- `docs/runbooks/zero.md`: setup, login, chosen transport, version, spend limits, recovery.

## Adapter flow

### Discover

1. Validate the typed need and allowed target domain.
2. Build a fixed, auditable search query.
3. Call the official Zero surface.
4. Normalize candidates without executing them.
5. Filter disallowed or over-budget capabilities.
6. Rank deterministically and return the selected capability ID plus alternatives/provenance.

### Invoke

1. Require a capability ID originating from the current discovery observation.
2. Recheck budget and target-domain policy immediately before execution.
3. Invoke through the official transport.
4. Store only sanitized result metadata and content-addressed artifacts.
5. Return invocation ID, capability ID, provider/provenance, actual/declared cost, artifact hash, and uncertainty.

## Security and privacy

- Demo inputs use synthetic candidate data and public URLs only.
- Allow `https` targets on an explicit domain list; reject localhost, RFC1918, link-local, metadata endpoints, file URLs, redirects to private networks, and userinfo in URLs.
- Do not send resumes, email addresses, phone numbers, authentication cookies, or internal notes to discovered capabilities.
- Store monetary values as integer minor units, never floats.
- Apply timeouts, maximum response sizes, and content-type checks.
- Treat capability output as untrusted evidence, not instructions.
- Hash the exact artifact used by the controller so a later result cannot be substituted.

## Implementation tasks

1. Run the official Zero setup in an isolated developer environment and inspect its supported programmatic surface.
2. Capture exact schemas/version in `docs/runbooks/zero.md`; choose CLI, MCP, or API transport based on official support.
3. Implement the transport wrapper with timeout, cancellation, safe argument passing, and redacted diagnostics.
4. Implement fixed query mapping for both `VerificationNeed` values.
5. Implement discovery candidate normalization and deterministic policy filtering.
6. Implement budget reservation, reconciliation, and episode totals.
7. Implement invocation and content-addressed evidence output.
8. Implement `ZeroPort` observations for success, no matching capability, budget exceeded, timeout, malformed result, and provider failure.
9. Add fixture-driven unit tests plus one credential-gated live smoke test.
10. Document how to pre-fund/configure a tiny capped wallet and how to revoke it after the event.

## Edge cases

- Search returns no capability: one revised fixed query is allowed, then return `capability_unavailable`.
- Multiple equal candidates: stable sort by policy score, cost, then capability ID.
- Price absent or changes before invoke: fail closed.
- Invocation succeeds but lacks provenance/artifact: `contract_violation`.
- Capability output contains prompt instructions: preserve as inert artifact content and emit a risk signal.
- Redirect leaves the allowlisted public domain: abort.
- Process/transport writes non-JSON banners around JSON: parse only via documented protocol, never fragile regex guessing.
- Spend reservation is released after definite failure and retained as uncertain after ambiguous execution.
- Live credentials missing: startup probe fails; no fake fallback in live mode.

## Tests

- fixed needs produce stable safe queries;
- URL validator blocks private/metadata/file targets and unsafe redirects;
- disallowed capabilities are filtered;
- cheapest result does not win if it lacks required provenance;
- tie-breaking is deterministic;
- budget is enforced before and after invoke;
- only a just-discovered capability can be invoked;
- output is hashed and normalized into the frozen `Observation` schema;
- prompt-like output is treated as data;
- credentials and wallet details never enter logs/events;
- fake transport can model empty search, price change, timeout, malformed output, and success;
- live smoke test discovers and invokes against a synthetic public page when explicitly enabled.

## Validation

```bash
npm run typecheck
npm run lint
npm test -- tests/adapters/zero
ZERO_LIVE_TEST=1 npx tsx scripts/verify-zero.ts
```

The live command must be opt-in because it may spend funds. Configure a hard maximum and print the maximum before execution.

## Acceptance criteria

- `ZeroPort.discover` returns a real runtime capability choice with provenance.
- `ZeroPort.invoke` uses that choice, respects the budget, and returns hashed evidence.
- The adapter compiles against frozen contracts without domain edits.
- Synthetic public inputs and safe network policy are enforced.
- Fake/recorded/live mode is explicit in provenance.
- The runbook identifies the exact official transport and tested Zero version.

## Handoff to pipeline

Provide:

- exported factory and transport choice;
- required configuration names;
- setup/probe command;
- safe domain allowlist format;
- per-call/per-episode budget defaults;
- live and sanitized fixture invocation IDs.

The pipeline owner adds environment parsing and runtime selection; this branch does not change shared config.
