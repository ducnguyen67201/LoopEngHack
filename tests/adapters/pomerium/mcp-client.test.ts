import type { AddressInfo } from 'node:net';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { PomeriumMcpClient } from '../../../src/adapters/pomerium/mcp-client.js';

const secretJwt = 'eyJhbGciOiJIUzI1NiJ9.secret-service-account-jwt';
const authorizationHeader = `Bearer Pomerium-${secretJwt}`;

describe('PomeriumMcpClient', () => {
  it('completes an authenticated Streamable HTTP tool call and captures its request ID', async () => {
    const app = createMcpExpressApp();
    app.post('/mcp', async (request, response) => {
      if (request.header('authorization') !== authorizationHeader) {
        response.status(401).end();
        return;
      }

      response.setHeader('x-request-id', 'request-allow-1');
      const server = new McpServer({ name: 'test-upstream', version: '1.0.0' });
      server.registerTool(
        'fillmore_schedule_screen',
        { inputSchema: { candidate_id: z.string() } },
        ({ candidate_id }) =>
          Promise.resolve({
            content: [{ type: 'text' as const, text: `scheduled:${candidate_id}` }],
          }),
      );
      const transport = new StreamableHTTPServerTransport();

      await server.connect(transport as Transport);
      await transport.handleRequest(request, response, request.body);
      response.on('close', () => {
        void transport.close();
        void server.close();
      });
    });

    const httpServer = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = httpServer.address() as AddressInfo;
    const client = new PomeriumMcpClient({
      routeUrl: `http://127.0.0.1:${address.port}/mcp`,
      authorizationHeader,
      allowInsecureHttp: true,
    });

    try {
      const outcome = await client.callTool('fillmore_schedule_screen', {
        candidate_id: 'candidate-1',
      });

      expect(outcome.status).toBe('success');
      expect(outcome.requestId).toBe('request-allow-1');
      expect(outcome.status === 'success' ? outcome.result.content : []).toContainEqual({
        type: 'text',
        text: 'scheduled:candidate-1',
      });
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });

  it('injects the service identity and normalizes an expected Pomerium denial', async () => {
    const observedHeaders: Headers[] = [];
    const deniedFetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      observedHeaders.push(new Headers(init?.headers));
      return Promise.resolve(
        new Response('forbidden and deliberately not exposed', {
          status: 403,
          headers: { 'x-request-id': 'request-deny-1' },
        }),
      );
    });
    const client = new PomeriumMcpClient({
      routeUrl: 'https://sourcer-mcp.example.test/mcp',
      authorizationHeader,
      fetch: deniedFetch,
    });

    const outcome = await client.callTool('fillmore_schedule_screen', {
      episode_id: 'episode-1',
      candidate_id: 'candidate-1',
      evidence_id: 'evidence-1',
    });

    expect(outcome).toEqual({
      status: 'denied',
      kind: 'authorization_denied',
      requestId: 'request-deny-1',
      summary: 'Pomerium denied the MCP tool request',
      retriable: false,
    });
    expect(observedHeaders[0]?.get('authorization')).toBe(authorizationHeader);
    expect(JSON.stringify(outcome)).not.toContain(secretJwt);
    expect(JSON.stringify(outcome)).not.toContain('deliberately not exposed');
  });

  it('isolates request correlation across concurrent denied calls', async () => {
    let requestNumber = 0;
    const deniedFetch = vi.fn<typeof globalThis.fetch>(() => {
      requestNumber += 1;
      return Promise.resolve(
        new Response('forbidden', {
          status: 403,
          headers: { 'x-request-id': `request-deny-${requestNumber}` },
        }),
      );
    });
    const client = new PomeriumMcpClient({
      routeUrl: 'https://sourcer-mcp.example.test/mcp',
      authorizationHeader,
      fetch: deniedFetch,
    });

    const outcomes = await Promise.all([
      client.callTool('fillmore_schedule_screen', { candidate_id: 'candidate-1' }),
      client.callTool('fillmore_schedule_screen', { candidate_id: 'candidate-2' }),
    ]);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['denied', 'denied']);
    expect(outcomes.map((outcome) => outcome.requestId).sort()).toEqual([
      'request-deny-1',
      'request-deny-2',
    ]);
  });

  it('requires HTTPS unless an explicit local-test override is supplied', () => {
    expect(
      () =>
        new PomeriumMcpClient({
          routeUrl: 'http://localhost:9443/mcp',
          authorizationHeader,
        }),
    ).toThrow('Pomerium MCP route must use HTTPS');
  });

  it('rejects malformed credentials without echoing them', () => {
    const malformed = 'Bearer definitely-not-a-pomerium-token';

    expect(
      () =>
        new PomeriumMcpClient({
          routeUrl: 'https://controller-mcp.example.test/mcp',
          authorizationHeader: malformed,
        }),
    ).toThrow('Pomerium authorization header is invalid');

    try {
      new PomeriumMcpClient({
        routeUrl: 'https://controller-mcp.example.test/mcp',
        authorizationHeader: malformed,
      });
    } catch (error) {
      expect(String(error)).not.toContain(malformed);
    }
  });
});
