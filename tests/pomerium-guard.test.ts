import { generateKeyPairSync, sign } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  PomeriumAccessDeniedError,
  PomeriumAccessGuard,
  PomeriumJwtVerifier,
  PomeriumMcpClient,
  PomeriumPolicyPort,
} from '../src/adapters/pomerium/index.js';
import { NamespacedIdGenerator } from '../src/runtime/primitives.js';
import { loadPomeriumCoreSmokeConfiguration } from '../scripts/verify-pomerium-core.js';

describe('Pomerium application-layer guard', () => {
  it('verifies the signed assertion and enforces the actor tool map', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    jwk.kid = 'test-key';
    const nowSeconds = 1_784_320_000;
    const assertion = jwt(
      privateKey,
      { alg: 'ES256', kid: 'test-key' },
      {
        sub: 'sourcer-service-account',
        iss: 'https://auth.example.test',
        aud: 'https://arena.example.test',
        exp: nowSeconds + 300,
      },
    );
    const verifier = new PomeriumJwtVerifier({
      jwksUrl: 'https://arena.example.test/.well-known/pomerium/jwks.json',
      issuer: 'https://auth.example.test',
      audience: 'https://arena.example.test',
      now: () => nowSeconds * 1000,
      fetch: () => Promise.resolve(new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })),
    });
    const guard = new PomeriumAccessGuard({
      sourcerSubject: 'sourcer-service-account',
      controllerSubject: 'controller-service-account',
    });

    const identity = guard.resolve(await verifier.verify(assertion));
    expect(identity.actor).toBe('outbound-sourcer');
    expect(() => guard.requireTool(identity, 'recruiting_schedule_screen')).toThrow(
      PomeriumAccessDeniedError,
    );
    expect(() => guard.requireTool(identity, 'recruiting_read_pipeline_event')).not.toThrow();
  });

  it('does not misreport an expired or unknown service identity as tool-policy proof', async () => {
    const port = new PomeriumPolicyPort({
      runId: 'identity-denial-run',
      ids: new NamespacedIdGenerator('identity-denial'),
      clients: {
        'outbound-sourcer': {
          callTool: () =>
            Promise.resolve({
              status: 'denied' as const,
              kind: 'identity_denied' as const,
              summary: 'Pomerium rejected the service identity',
              retriable: false,
            }),
        },
      },
    });
    const observation = await port.authorize(
      {
        episodeId: 'identity-denial-episode',
        attemptId: 'identity-denial-attempt',
        actor: 'outbound-sourcer',
        tool: 'recruiting_schedule_screen',
      },
      {
        episodeId: 'identity-denial-episode',
        attemptId: 'identity-denial-attempt',
        actor: 'outbound-sourcer',
        turn: 3,
        phase: 'authorize',
        occurredAt: '2026-07-17T20:00:00.000Z',
      },
    );

    expect(observation).toMatchObject({
      status: 'error',
      errorCategory: 'upstream_failure',
      provenance: 'pomerium-authorize-log',
    });
    expect(observation.authorization).toBeUndefined();
  });

  it('runs client, JWT/JWKS verification, guard, and protected tool behavior end to end locally', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    jwk.kid = 'local-integration-key';
    const nowSeconds = 1_784_320_000;
    let jwksRequests = 0;
    const verifier = new PomeriumJwtVerifier({
      jwksUrl: 'https://local-gateway.example.test/.well-known/pomerium/jwks.json',
      issuer: 'https://auth.example.test',
      audience: 'https://local-gateway.example.test',
      now: () => nowSeconds * 1000,
      fetch: () => {
        jwksRequests += 1;
        return Promise.resolve(Response.json({ keys: [jwk] }));
      },
    });
    const guard = new PomeriumAccessGuard({
      sourcerSubject: 'sourcer-service-account',
      controllerSubject: 'controller-service-account',
    });
    const sourcerAssertion = jwt(
      privateKey,
      { alg: 'ES256', kid: 'local-integration-key' },
      {
        sub: 'sourcer-service-account',
        iss: 'https://auth.example.test',
        aud: 'https://local-gateway.example.test',
        exp: nowSeconds + 300,
      },
    );
    const controllerAssertion = jwt(
      privateKey,
      { alg: 'ES256', kid: 'local-integration-key' },
      {
        sub: 'controller-service-account',
        iss: 'https://auth.example.test',
        aud: 'https://local-gateway.example.test',
        exp: nowSeconds + 300,
      },
    );
    let protectedExecutions = 0;
    const app = createMcpExpressApp();
    app.post('/mcp', async (request, response) => {
      const authorization = request.header('authorization');
      const assertion = authorization?.startsWith('Bearer Pomerium-')
        ? authorization.slice('Bearer Pomerium-'.length)
        : undefined;
      if (assertion === undefined) {
        response.status(401).end();
        return;
      }

      const identity = guard.resolve(await verifier.verify(assertion));
      response.setHeader('x-request-id', `local-${identity.actor}`);
      const server = new McpServer({ name: 'local-guarded-recruiting', version: '1.0.0' });
      server.registerTool(
        'recruiting_schedule_screen',
        { inputSchema: { candidate_id: z.string() } },
        ({ candidate_id }) => {
          guard.requireTool(identity, 'recruiting_schedule_screen');
          protectedExecutions += 1;
          return Promise.resolve({
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ operationId: `calendar-${candidate_id}` }),
              },
            ],
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
    });
    const httpServer = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = httpServer.address() as AddressInfo;
    const routeUrl = `http://127.0.0.1:${address.port}/mcp`;
    const sourcerClient = new PomeriumMcpClient({
      routeUrl,
      authorizationHeader: `Bearer Pomerium-${sourcerAssertion}`,
      allowInsecureHttp: true,
    });
    const controllerClient = new PomeriumMcpClient({
      routeUrl,
      authorizationHeader: `Bearer Pomerium-${controllerAssertion}`,
      allowInsecureHttp: true,
    });

    try {
      const denied = await sourcerClient.callTool('recruiting_schedule_screen', {
        candidate_id: 'candidate-1',
      });
      expect(denied).toMatchObject({
        status: 'error',
        kind: 'protocol_error',
        requestId: 'local-outbound-sourcer',
      });
      expect(protectedExecutions).toBe(0);

      const allowed = await controllerClient.callTool('recruiting_schedule_screen', {
        candidate_id: 'candidate-1',
      });
      expect(allowed).toMatchObject({
        status: 'success',
        requestId: 'local-hiring-controller',
      });
      expect(allowed.status === 'success' ? allowed.result.content : []).toContainEqual({
        type: 'text',
        text: JSON.stringify({ operationId: 'calendar-candidate-1' }),
      });
      expect(protectedExecutions).toBe(1);
      expect(jwksRequests).toBe(1);
    } finally {
      await sourcerClient.close();
      await controllerClient.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });
});

describe('Pomerium Core smoke prerequisites', () => {
  it('fails before network access when the local CA prerequisite is absent', () => {
    expect(() =>
      loadPomeriumCoreSmokeConfiguration({
        SOURCER_CORE_SMOKE_URL: 'https://sourcer-mcp.localhost.pomerium.io:8443',
        CONTROLLER_CORE_SMOKE_URL: 'https://controller-mcp.localhost.pomerium.io:8443',
      }),
    ).toThrow('NODE_EXTRA_CA_CERTS must point to .pomerium/core-ca.pem');
  });

  it('rejects a fake same-route comparison and non-HTTPS protected routes', () => {
    expect(() =>
      loadPomeriumCoreSmokeConfiguration({
        SOURCER_CORE_SMOKE_URL: 'https://recruiting.example.test/mcp',
        CONTROLLER_CORE_SMOKE_URL: 'https://recruiting.example.test/mcp',
      }),
    ).toThrow('Sourcer and Controller smoke routes must be distinct');
    expect(() =>
      loadPomeriumCoreSmokeConfiguration({
        SOURCER_CORE_SMOKE_URL: 'http://sourcer.example.test/mcp',
        CONTROLLER_CORE_SMOKE_URL: 'https://controller.example.test/mcp',
      }),
    ).toThrow('SOURCER_CORE_SMOKE_URL must be a credential-free HTTPS route URL');
  });

  it('accepts distinct remote HTTPS routes without weakening TLS verification', () => {
    const configuration = loadPomeriumCoreSmokeConfiguration({
      SOURCER_CORE_SMOKE_URL: 'https://sourcer.example.test/mcp',
      CONTROLLER_CORE_SMOKE_URL: 'https://controller.example.test/mcp',
      POMERIUM_SMOKE_TIMEOUT_MS: '2500',
      POMERIUM_SMOKE_EVIDENCE_PATH: '.pomerium/test-proof.json',
    });

    expect(configuration.sourcerUrl.href).toBe('https://sourcer.example.test/mcp');
    expect(configuration.controllerUrl.href).toBe('https://controller.example.test/mcp');
    expect(configuration.timeoutMs).toBe(2500);
    expect(configuration.evidencePath).toMatch(/\.pomerium\/test-proof\.json$/);
  });
});

function jwt(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  header: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
): string {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
