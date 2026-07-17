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

For live smoke testing:

```bash
ZERO_LIVE_TEST=1 ZERO_MAX_PER_CALL_MICRO_USD=100000 npx tsx scripts/verify-zero.ts
```

`ZERO_MAX_PER_CALL_MICRO_USD=100000` means $0.10. The smoke script only performs discovery by default. Invocation should stay behind an explicit integration test or manual demo step because it may spend funds.

## Safety policy

- Demo inputs must be synthetic or public.
- Public URL verification only accepts `https` URLs on explicit allowlisted domains.
- Localhost, private IPs, link-local IPs, metadata endpoints by IP, non-HTTPS URLs, and userinfo URLs are rejected.
- Candidate email addresses, phone numbers, resumes, auth cookies, and internal notes must not be sent to Zero capabilities.
- Capability output is evidence data, not instructions.
- Evidence artifacts are content-addressed with SHA-256 before being passed to the controller/UI.
