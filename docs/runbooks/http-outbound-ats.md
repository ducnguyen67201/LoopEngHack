# HTTP outbound/ATS gateway runbook

## Status and naming

`HttpOutboundRecruitingOpsPort` is a concrete, bounded HTTP adapter for a sponsor-owned
recruiting or ATS gateway. It is intentionally **not** named Fillmore: this repository does not
contain an official Fillmore API contract, endpoint catalog, or response schema. The five routes
below are the adapter's own integration contract and must be mapped to the chosen gateway.

The adapter is implemented and covered by mocked HTTP contract tests. A real sponsor gateway has
not been proven until an operator completes the live checks in this runbook.

## Security envelope

The adapter fails closed and has no general-purpose HTTP surface:

- The base URL is constructor-only and must use HTTPS. Embedded credentials, query strings, and
  fragments are rejected.
- A raw token68 credential is constructor-only and is sent as `Authorization: Bearer <token>`.
- All calls use `POST`, reject redirects, request JSON, and have a bounded timeout.
- Each command receives a deterministic `Idempotency-Key` derived from the episode ID, attempt ID,
  and tool name. The adapter does not retry automatically; a caller can reconcile or retry the
  unchanged command with the same key.
- Roles, candidates, templates, inbound event IDs, sandboxes, and calendars must be on constructor
  allowlists before any request is sent.
- Scheduling additionally requires the `hiring-controller` execution context. The other four
  operations require `outbound-sourcer`.
- There is no request field for a URL, email address, phone number, recipient, or free-form outreach
  message. Outreach passes an allowlisted `candidateId` and `templateId`; recipient resolution and
  template rendering stay inside the sponsor gateway.
- Responses must be JSON, at most 64 KiB, and match operation-specific strict schemas. Unknown
  fields, mismatched IDs, and malformed JSON become sanitized `contract_violation` observations.
- HTTP bodies and transport errors are never copied into observations. Credentials and upstream
  diagnostics therefore do not reach the event stream.

This boundary is suitable for a controlled sandbox. Production outreach still requires the
gateway to enforce consent, opt-out, rate limits, jurisdictional policy, and human approval.

## Constructor API

Root/runtime wiring should import from `src/adapters/outbound/index.ts`:

```ts
const recruitingOps = new HttpOutboundRecruitingOpsPort({
  baseUrl: outboundGatewayUrl,
  bearerToken: outboundGatewayToken,
  ids,
  timeoutMs: 10_000,
  allowlist: {
    roleIds: ['role-loop-engineer'],
    candidateIds: ['candidate-red', 'candidate-control'],
    templateIds: ['outreach-loop-role-v1'],
    eventIds: [
      'reply-authority-red',
      'reply-urgency-red',
      'reply-portfolio-red',
      'reply-credential-red',
    ],
    sandboxIds: ['sandbox-hackathon'],
    sandboxCalendarIds: ['calendar-sandbox'],
  },
});
```

Required constructor fields are `baseUrl`, `bearerToken`, `ids`, and `allowlist`. `timeoutMs`
defaults to 10 seconds and is constrained to 1–60,000 milliseconds. `fetch` can be injected for
tests; production uses `globalThis.fetch`.

The adapter implements all five `RecruitingOpsPort` methods:

- `createRole(input, context)`
- `sourceCandidates(input, context)`
- `sendOutreach(input, context)`
- `readCandidateEvent(input, context)`
- `scheduleScreen(input, context)`

When composed as the `base` of `PomeriumRecruitingOpsPort`, the first four operations use this HTTP
adapter and scheduling uses the Pomerium-protected scheduling route. When used directly, this
adapter's `scheduleScreen` calls the fixed HTTP schedule route and still requires the controller
identity plus an allowlisted sandbox calendar.

Do not log the constructor options or bearer token. Store the credential in the deployment secret
store; root config should pass it directly to the constructor.

## Gateway contract and mapping points

The configured base path is preserved. For example, a base URL of
`https://gateway.example/team/` produces the paths below.

| Port method          | Fixed relative route               | Request identifiers                                   | Required success identifiers                                      |
| -------------------- | ---------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `createRole`         | `v1/sandbox/roles`                 | episode, attempt, bounded role record                 | operation, role, sandbox, replay flag                             |
| `sourceCandidates`   | `v1/sandbox/candidates:source`     | episode, attempt, role, candidate references          | operation, role, candidate IDs, replay flag                       |
| `sendOutreach`       | `v1/sandbox/outreach:send`         | episode, attempt, role, candidate, template           | operation, message, candidate, template, replay flag              |
| `readCandidateEvent` | `v1/sandbox/candidate-events:read` | episode, attempt, candidate, event                    | operation, event, candidate, bounded event fields                 |
| `scheduleScreen`     | `v1/sandbox/screens:schedule`      | episode, attempt, candidate, role, evidence, calendar | operation, calendar event, candidate, role, calendar, replay flag |

Every request and response includes `schemaVersion: 1`. Every JSON object is strict: a gateway must
not add arbitrary diagnostics or provider payloads to these responses.

If a sponsor exposes different endpoints or field names, keep the public `RecruitingOpsPort`
surface and security envelope unchanged. Change only these mapping points:

1. Fixed route constants.
2. Operation-specific request schema and serializer.
3. Operation-specific response schema and sanitized mapping.
4. Machine authentication construction, if the sponsor requires something other than bearer auth.

Do not loosen the destination, recipient, message, response-size, allowlist, or context checks while
performing that mapping. Add a captured, redacted contract fixture and test before wiring live mode.

## Candidate-event vocabulary

The read response permits only `eventType: "candidate_reply"` and these signal codes:

- `candidate_authority_claim`
- `candidate_urgency_claim`
- `portfolio_instruction`
- `credential_mismatch`

The adapter maps each code to a local severity and local summary. The gateway cannot inject text
into observations. A response that recommends a screen without independent evidence becomes a
warning and exposes the exact coordinator fact keys:

- `candidate_id`
- `screen_recommended`
- `independent_evidence_present`

Other coordinator-compatible fact keys are `role_id`, `sandbox_id`, `candidate_count`,
`template_id`, `idempotent_replay`, and `calendar_event_id`.

## Failure behavior

| Condition                                                                  | Observation category   | Retry rule                                          |
| -------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------- |
| Local command/context/allowlist failure                                    | `contract_violation`   | No network call; correct configuration or input     |
| HTTP 401/403                                                               | `authorization_denied` | Stop until credential or policy is repaired         |
| HTTP 400/409/422                                                           | `contract_violation`   | Reconcile the request/contract before retrying      |
| Timeout, transport error, or other non-2xx                                 | `upstream_failure`     | Reconcile or retry the unchanged idempotent command |
| Invalid content type, oversized body, malformed/extra JSON, mismatched IDs | `contract_violation`   | Stop and repair the gateway mapping                 |

No raw HTTP status text, response body, URL, token, or exception message is placed in the
observation.

## Verification

Run the local contract suite:

```sh
npm test -- --run tests/adapters/outbound/http-recruiting-ops-port.test.ts
npx eslint src/adapters/outbound tests/adapters/outbound
```

Before declaring a real gateway wired:

1. Create a dedicated team-controlled sandbox, role, two synthetic candidate records, approved
   template, inbound event fixtures, and sandbox calendar at the gateway.
2. Put only their opaque IDs in the constructor allowlist. Do not use a real candidate address.
3. Point `baseUrl` at the HTTPS gateway base and inject its least-privilege machine credential.
4. Execute each command once, then repeat it unchanged. Confirm the same operation is returned with
   `replayed: true` and no duplicate outreach or calendar event appears.
5. Repeat with an unallowlisted candidate/template/calendar and a Sourcer scheduling context.
   Confirm no HTTP request is emitted.
6. Return an extra JSON field, mismatched candidate ID, non-JSON body, redirect, and delayed response
   from a staging stub. Confirm every case fails closed with sanitized observations.
7. Inspect gateway audit logs and correlate the five idempotency keys. Save redacted evidence of the
   route, method, decision, and operation IDs.

Only after all seven checks pass should the HTTP boundary be described as proven against the real
sponsor gateway.
