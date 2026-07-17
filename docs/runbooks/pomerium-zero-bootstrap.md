# Pomerium Zero bootstrap

This runbook connects the local Docker data plane to Pomerium Zero. The local
Core runbook proves route-scoped MCP tool authorization. Zero service-account
identity proof remains credential-dependent and is not established merely by
passing the local Core smoke test.

## 1. Copy the generated values

On the Pomerium Zero onboarding page:

1. Select **Docker**.
2. Continue to the generated Compose configuration.
3. Copy the value shown as `POMERIUM_ZERO_TOKEN`.
4. Record the generated starter domain shown in the Console.

Never paste the token into chat, documentation, a screenshot, or Git.

## 2. Create the local environment

From `loop-engine-hackathon`:

```bash
cp .env.example .env
```

Edit only the local `.env` and set:

```dotenv
POMERIUM_ZERO_TOKEN=<generated cluster token>
POMERIUM_STARTER_DOMAIN=<generated starter subdomain>.pomerium.app
```

The repository ignores `.env` and common key/JWT file extensions.

## 3. Start only Pomerium

Port 443 must be available. Start the Zero-managed data plane without waiting
for the unfinished application containers:

```bash
docker compose --profile pomerium up -d pomerium
docker compose ps pomerium
docker compose logs --tail=100 pomerium
```

Return to the Zero onboarding page. When it reports the deployment connected,
select **Finish**.

## 4. Confirm the MCP build before adding routes

Pomerium's MCP support is currently documented as experimental and requires:

```yaml
runtime_flags:
  mcp: true
```

Runtime flags are configured on the local Core data plane, not in the Zero
Console. This repository's `compose.yaml` supplies the equivalent environment
setting:

```yaml
RUNTIME_FLAGS: '{"mcp":true}'
```

It is documented as available from builds of `main`, not necessarily the stable
`latest` image. Ask the Pomerium sponsor for the exact image digest used for the
hackathon, set `POMERIUM_IMAGE` in `.env`, and recreate the container:

```bash
docker compose --profile pomerium pull pomerium
docker compose --profile pomerium up -d --force-recreate pomerium
```

Do not use an unpinned moving `main` image during judging.

## 5. Target authorization proof

After the recruiting MCP endpoint exists, configure identity-specific service
accounts and tool allowlists so the same request produces different decisions:

```text
outbound-sourcer  -> recruiting_schedule_screen -> DENY
hiring-controller -> recruiting_schedule_screen -> ALLOW
```

Keep positive identity checks under `allow`. Put `mcp_tool.not_in` allowlists
under `deny` so MCP session setup and `tools/list` continue to work.

The upstream route will point to the internal Streamable HTTP endpoint, for
example `http://arena:8080/mcp`; it must not point back to the public Pomerium
hostname.

For the final proof, run the same protected tool and identical input through
each authenticated service-account route. Save the two request IDs and
correlate them with the Pomerium authorization log:

```text
outbound-sourcer  -> recruiting_schedule_screen -> DENY -> request <id>
hiring-controller -> recruiting_schedule_screen -> ALLOW -> request <id>
```

Do not mark this step complete when either service-account credential, route,
JWKS/issuer/audience setting, or authorization log is unavailable. The local
Core proof is useful fallback evidence, but it is not a substitute for this
identity-scoped Zero proof.

## Troubleshooting

- If the container cannot bind, check whether another process owns port 443.
- If Zero never reports connected, verify the token and outbound connectivity.
- If the public route fails, confirm inbound 443 reaches this Docker host.
- If normal HTTP works but MCP policy fields do not, verify the pinned image and
  `runtime_flags.mcp` setting with the sponsor.
