import { pathToFileURL } from 'node:url';

import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';

const port = Number.parseInt(process.env.POMERIUM_SMOKE_UPSTREAM_PORT ?? '8084', 10);

function createServer(): McpServer {
  const server = new McpServer({ name: 'recruiting-policy-smoke', version: '0.1.0' });

  server.registerTool(
    'recruiting_find_candidates',
    {
      description: 'Read-only candidate discovery used to prove the Sourcer route is healthy.',
      inputSchema: { query: z.string() },
    },
    ({ query }) => {
      process.stdout.write(`[UPSTREAM EXECUTED] recruiting_find_candidates query=${query}\n`);
      return Promise.resolve({
        content: [{ type: 'text' as const, text: 'candidate-demo-1' }],
      });
    },
  );

  server.registerTool(
    'recruiting_schedule_screen',
    {
      description: 'Consequential tool that only the Controller route may execute.',
      inputSchema: { candidate_id: z.string() },
    },
    ({ candidate_id }) => {
      process.stdout.write(
        `[UPSTREAM EXECUTED] recruiting_schedule_screen candidate=${candidate_id}\n`,
      );
      return Promise.resolve({
        content: [{ type: 'text' as const, text: `scheduled:${candidate_id}:synthetic-calendar` }],
      });
    },
  );

  return server;
}

export function startSmokeServer() {
  const app = createMcpExpressApp({
    host: '0.0.0.0',
    allowedHosts: [
      'host.docker.internal',
      'localhost',
      '127.0.0.1',
      'sourcer-mcp.localhost.pomerium.io',
      'controller-mcp.localhost.pomerium.io',
    ],
  });

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: 'recruiting-policy-smoke' });
  });

  app.post('/mcp', async (request, response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport();

    try {
      await server.connect(transport as Transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      process.stderr.write(`MCP smoke server error: ${String(error)}\n`);
      if (!response.headersSent) response.status(500).end();
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  return app.listen(port, '0.0.0.0', () => {
    process.stdout.write(`Recruiting MCP smoke server listening on http://0.0.0.0:${port}/mcp\n`);
  });
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  startSmokeServer();
}
