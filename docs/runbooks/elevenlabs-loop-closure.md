# ElevenLabs phone closure

The optional phone-closure adapter keeps a finished learning run open until the operator answers an
outbound ElevenLabs call and speaks a closing response.

```text
learning loop terminal result
  -> ElevenLabs outbound call
  -> run status: awaiting_human
  -> signed post-call transcript webhook
  -> run status: complete or failed
```

If phone closure is disabled, the existing behavior is unchanged: the computed result immediately
becomes the run's terminal status.

## One-time ElevenLabs setup

1. Create or select an ElevenLabs Agent.
2. Attach a Twilio-backed phone number to ElevenLabs and the Agent.
3. Give the Agent this concise system prompt:

   ```text
   You close one finished automated learning loop. Briefly state the supplied result and ask:
   "Please give a brief response to close this loop." Wait for one substantive response, acknowledge it,
   thank the operator, and end the call. Do not take any other action.
   ```

4. Use this first message so the server-supplied dynamic variables provide the context:

   ```text
   Hi. Loop {{loop_id}} finished with status {{loop_status}} and readiness
   {{readiness_score}}. Reason: {{loop_reason}}. Please give a brief response to close this loop.
   ```

5. In ElevenLabs **Developers → Webhooks**, add this public HTTPS endpoint:

   ```text
   https://<public-arena-host>/api/webhooks/elevenlabs
   ```

6. Enable `post_call_transcription` and `call_initiation_failure`, enable HMAC authentication, and
   copy the generated webhook secret.

The server verifies `ElevenLabs-Signature` before parsing the webhook. Invalid, missing, or stale
signatures are rejected. The first non-empty user transcript turn closes the loop. The raw response
is immediately reduced to a one-way digest for duplicate detection; raw speech and audio are not
retained by the Arena.

Official references:

- https://elevenlabs.io/docs/api-reference/twilio/outbound-call/
- https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables
- https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks

## Local configuration

`npm run dev` loads the ignored local `.env` automatically. Configure all fields before enabling the
feature:

```dotenv
ELEVENLABS_LOOP_CLOSURE_ENABLED=true
INTERNAL_AGENT_TOKEN=<operator-bearer-token-at-least-24-characters>
ELEVENLABS_API_KEY=<scoped-api-key>
ELEVENLABS_AGENT_ID=<agent-id>
ELEVENLABS_PHONE_NUMBER_ID=<phone-number-id>
ELEVENLABS_TO_NUMBER=<operator-number-in-e164-format>
ELEVENLABS_WEBHOOK_SECRET=<webhook-hmac-secret>
```

Keep the destination number in E.164 format, for example `+14155550123`. For local webhook testing,
expose port 8080 through an HTTPS tunnel and use the resulting public URL in ElevenLabs.

The API key, destination number, and webhook secret remain server-side. The call receives only these
bounded dynamic variables:

- loop ID and computed status
- readiness score and terminal reason
- episode count
- hostile evaluation, legitimate control, and attack-family counts

No event history, candidate data, evidence content, Pomerium credentials, or Zero credentials are
sent to ElevenLabs.

When phone closure is enabled, `POST /api/episodes` requires
`Authorization: Bearer ${INTERNAL_AGENT_TOKEN}` even in fake mode. This prevents an unauthenticated
caller from triggering paid outbound calls.

Use only a phone number owned by, or explicitly consented for calls by, the operator. The adapter
explicitly disables Twilio call recording; the Arena does not request an audio webhook.

## Runtime behavior

After the outbound call is accepted, `GET /api/episodes/:id` reports:

```json
{
  "status": "awaiting_human",
  "closure": {
    "status": "awaiting_response",
    "conversationId": "...",
    "responseReceived": false,
    "closedAt": null
  }
}
```

When the signed transcript arrives with a spoken response, the run returns to its computed terminal
status and emits `loop_completed` (or the existing safe failure event). Duplicate delivery of the
same response is idempotent. A no-answer initiation failure or a completed call without user speech
fails the phone-closure step safely.

Tests inject a fake closure port and never initiate a live or paid call.
