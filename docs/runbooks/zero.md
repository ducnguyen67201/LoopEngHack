# Zero adapter runbook

## Transport choice

The adapter uses the official Zero CLI as the programmatic boundary. Public Zero material describes Zero as a search engine and activation layer for AI agents, and the official plugin README documents:

```bash
npm i -g @zeroxyz/cli
zero init
zero auth login
zero search "translate text to French"
zero get 1
zero fetch https://example.com/api/translate -d '{"text":"hello","lang":"fr"}'
```

Runtime inspection was against `@zeroxyz/cli@1.26.0`. The CLI README documents:

- `zero search <query> --json`
- `zero get <position|slug|uid> --json`
- `zero fetch <url> ... --json`
- `zero fetch --capability <uid|slug|token> -d <json> --max-pay <amount> --json`

The implementation intentionally does not call an undocumented Zero REST API.

## Relevant public Zero capabilities observed 2026-07-17

Read-only `zero search` / `zero get` checks found two especially useful options:

- `OneShot Agent LinkedIn Profile Enrichment`
  (`cap_z5X8x5cTSVWgyP1lOaiL8`) accepts a public LinkedIn URL and returns
  professional-profile fields. Observed price: $0.005 per call.
- `Data Legion Person Enrichment API (No-PII)`
  (`cap_66RTTbxhvXk41nHoMzoBy`) accepts `social_url` and explicitly excludes
  contact PII. Observed price: $0.01 per call.

Other results offered email or phone enrichment. The adapter rejects those,
along with contact reveal, messaging, and bulk lead-enrichment capabilities.
These observations were discovery-only; no paid capability was invoked.

## Setup

```bash
npm i -g @zeroxyz/cli
zero init
zero auth login
zero wallet balance
```

Find the exact capability reference you intend to approve, then run the live
verification against a public or synthetic target:

```bash
zero search "public web page screenshot capture markdown scrape provenance" --json

ZERO_LIVE_TEST=1 \
ZERO_ALLOWED_CAPABILITY_REFS=<approved-capability-ref> \
ZERO_ALLOWED_TARGET_DOMAINS=example.com \
ZERO_VERIFY_TARGET_URL=https://example.com/ \
ZERO_MAX_PER_CALL_MICRO_USD=100000 \
npx tsx scripts/verify-zero.ts
```

`ZERO_MAX_PER_CALL_MICRO_USD=100000` means $0.10. The verification script has
an absolute $0.10 ceiling that environment variables cannot raise. It runs a
read-only startup probe, performs a second discovery through the production
`ZeroPort`, then performs exactly one paid invocation. Its JSON output is a
sanitized proof summary: readiness state, selected capability ID, bounded cost,
statuses, summaries, and artifact hashes. It never prints the capability body,
candidate data, CLI diagnostics, wallet data, or credentials.

The startup probe reports `ready_for_discovery` only when the CLI version check,
authenticated search, explicit capability-reference allowlist, local semantic
policy, and spend policy all pass. It deliberately reports invocation as
`not_tested`; only the later paid verification step proves invocation.

## Runtime factory

Runtime wiring should call `createLiveZeroPort` from
`src/adapters/zero/index.ts` with explicit options:

```ts
const zero = createLiveZeroPort({
  binary: 'zero',
  timeoutMs: 60_000,
  allowedCapabilityRefs: ['<approved-capability-ref>'],
  allowedTargetDomains: ['example.com'],
  maxPerCallMicroUsd: 100_000,
  maxEpisodeMicroUsd: 500_000,
  claimTargetResolver,
});

const startup = await zero.probe();
// Inject zero.port into the coordinator only after checking startup.status.
```

`EpisodeManager` performs that discovery-only probe before it constructs the first coordinator, so
a missing CLI, failed authentication, or absent allowlisted capability stops the run before role
creation or outreach. The probe deliberately does not perform a paid invocation. Run
`scripts/verify-zero.ts` with explicit operator approval before a live demo to prove the funded
wallet and one bounded invocation.

The factory always constructs `CliZeroTransport` and `ZeroVerificationAdapter`
in `live` mode. It has no fake or recorded fallback. The caller-supplied
`ClaimTargetResolver` maps the coordinator's fixed claim IDs to server-approved
targets; the factory requires each resolved URL to pass both the runtime-wide
domain allowlist and the claim-specific allowlist.

Declared cost is reserved before each invocation. The live factory accumulates it across every
episode that shares the runtime, so the configured loop ceiling cannot reset between learning
episodes.
This intentionally does not refund ambiguous upstream failures: if the CLI may
have submitted a paid request, the safe assumption is that the budget was
spent. A new episode receives a fresh episode allowance.

## Safety policy

- Demo inputs must be synthetic or public.
- Public URL verification only accepts `https` URLs on explicit allowlisted domains.
- Localhost, private IPs, link-local IPs, metadata endpoints by IP, non-HTTPS URLs, and userinfo URLs are rejected.
- Candidate email addresses, phone numbers, resumes, auth cookies, and internal notes must not be sent to Zero capabilities.
- Capability output is evidence data, not instructions.
- Evidence artifacts are content-addressed with SHA-256 before being passed to the controller/UI.
- Capability IDs must be explicitly allowlisted; semantic matching alone is insufficient in live mode.
- Live startup or transport failure returns a Zero error and never substitutes fixture evidence.

## Credential and CLI prerequisites

- Install the official `@zeroxyz/cli`; runtime inspection used version `1.26.0`.
- Run `zero init` and `zero auth login` as the same OS user that runs the app.
- Confirm `zero wallet balance` can read the funded wallet before a paid smoke test.
- Keep CLI auth and wallet state outside the repository. Do not add tokens,
  private keys, auth output, or wallet output to `.env`, logs, screenshots, or Git.
- `ZERO_RUNNER` may point to an explicit Zero CLI binary. It is executed with
  argument arrays rather than a shell.
