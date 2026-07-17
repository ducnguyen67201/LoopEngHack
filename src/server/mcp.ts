import type { Express, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';

import type { AppConfig } from '../config.js';
import {
  PomeriumAccessDeniedError,
  PomeriumAccessGuard,
  PomeriumJwtVerifier,
  type VerifiedMachineIdentity,
} from '../adapters/pomerium/index.js';
import type { EpisodeManager } from '../runtime/episode-manager.js';

const boundedId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/);

export function mountRecruitingMcp(app: Express, config: AppConfig, manager: EpisodeManager): void {
  if (config.DEMO_MODE !== 'hybrid' && config.DEMO_MODE !== 'live') return;
  const verifier = new PomeriumJwtVerifier({
    jwksUrl: required(config.POMERIUM_JWKS_URL, 'POMERIUM_JWKS_URL'),
    issuer: required(config.POMERIUM_ISSUER, 'POMERIUM_ISSUER'),
    audience: required(config.POMERIUM_AUDIENCE, 'POMERIUM_AUDIENCE'),
  });
  const guard = new PomeriumAccessGuard({
    sourcerSubject: required(config.POMERIUM_SOURCER_SUBJECT, 'POMERIUM_SOURCER_SUBJECT'),
    controllerSubject: required(config.POMERIUM_CONTROLLER_SUBJECT, 'POMERIUM_CONTROLLER_SUBJECT'),
  });

  app.post('/mcp', async (request, response) => {
    const assertion = request.get('X-Pomerium-Jwt-Assertion');
    if (assertion === undefined) {
      response.status(401).json({ error: 'missing_pomerium_assertion' });
      return;
    }

    let identity: VerifiedMachineIdentity;
    try {
      identity = guard.resolve(await verifier.verify(assertion));
    } catch (error) {
      const status = error instanceof PomeriumAccessDeniedError ? 403 : 401;
      response.status(status).json({
        error: status === 403 ? 'pomerium_access_denied' : 'invalid_pomerium_assertion',
      });
      return;
    }

    try {
      await handleMcpRequest(request, response, identity, guard, manager);
    } catch {
      if (!response.headersSent) response.status(500).json({ error: 'mcp_internal_error' });
    }
  });
}

async function handleMcpRequest(
  request: Request,
  response: Response,
  identity: VerifiedMachineIdentity,
  guard: PomeriumAccessGuard,
  manager: EpisodeManager,
): Promise<void> {
  const server = new McpServer({ name: 'hire-me-if-you-can-recruiting', version: '0.1.0' });
  server.registerTool(
    'recruiting_schedule_screen',
    {
      description: 'Schedule one evidence-backed screen on the synthetic sandbox calendar.',
      inputSchema: {
        run_id: boundedId,
        episode_id: boundedId.optional(),
        evidence_id: boundedId.optional(),
        candidate_id: boundedId.optional(),
        role_id: boundedId.optional(),
        sandbox_calendar_id: boundedId.optional(),
        commit: z.boolean().default(false),
      },
    },
    (input) => {
      guard.requireTool(identity, 'recruiting_schedule_screen');
      if (!input.commit) {
        return Promise.resolve({
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ authorized: true, actor: identity.actor }),
            },
          ],
        });
      }
      const requiredInput = {
        episodeId: requireInput(input.episode_id, 'episode_id'),
        evidenceId: requireInput(input.evidence_id, 'evidence_id'),
        candidateId: requireInput(input.candidate_id, 'candidate_id'),
        roleId: requireInput(input.role_id, 'role_id'),
        sandboxCalendarId: requireInput(input.sandbox_calendar_id, 'sandbox_calendar_id'),
      };
      const scheduled = manager.executeProtectedSchedule(input.run_id, requiredInput);
      return Promise.resolve({
        content: [{ type: 'text' as const, text: JSON.stringify(scheduled) }],
      });
    },
  );

  const transport = new StreamableHTTPServerTransport();
  try {
    await server.connect(transport as Transport);
    await transport.handleRequest(request, response, request.body);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

function requireInput(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is required when commit is true`);
  return value;
}
