import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

interface Attempt {
  body?: unknown;
  error?: string;
  httpStatus?: number;
}

function withHttpStatus(attempt: Attempt, httpStatus: number | undefined): Attempt {
  return httpStatus === undefined ? attempt : { ...attempt, httpStatus };
}

async function callTool(
  routeUrl: string,
  tool: string,
  input: Record<string, unknown>,
): Promise<Attempt> {
  let httpStatus: number | undefined;
  const observedFetch: typeof globalThis.fetch = async (request, init) => {
    const response = await fetch(request, init);
    httpStatus = response.status;
    return response;
  };
  const client = new Client({ name: 'pomerium-core-smoke-verifier', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(routeUrl), { fetch: observedFetch });

  try {
    await client.connect(transport as Transport);
    const body = await client.callTool({ name: tool, arguments: input });
    return withHttpStatus({ body }, httpStatus);
  } catch (error) {
    return withHttpStatus({ error: String(error) }, httpStatus);
  } finally {
    await transport.terminateSession().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

function assertSuccess(label: string, attempt: Attempt): void {
  if (attempt.httpStatus !== 200 || attempt.error !== undefined) {
    throw new Error(`${label} should succeed, received ${JSON.stringify(attempt)}`);
  }
  process.stdout.write(`PASS  ${label} -> HTTP ${attempt.httpStatus}\n`);
}

function assertDenied(label: string, attempt: Attempt): void {
  const isPomeriumMcpDenial =
    attempt.httpStatus === 200 &&
    attempt.error?.includes('MCP error -32602: access denied') === true;
  if (!isPomeriumMcpDenial) {
    throw new Error(
      `${label} should return Pomerium's MCP access-denied error, received ${JSON.stringify(attempt)}`,
    );
  }
  process.stdout.write(`PASS  ${label} -> MCP access denied (blocked by Pomerium)\n`);
}

const sourcerUrl =
  process.env.SOURCER_CORE_SMOKE_URL ?? 'https://sourcer-mcp.localhost.pomerium.io:8443';
const controllerUrl =
  process.env.CONTROLLER_CORE_SMOKE_URL ?? 'https://controller-mcp.localhost.pomerium.io:8443';

const safeCall = await callTool(sourcerUrl, 'recruiting_find_candidates', {
  query: 'platform engineer',
});
assertSuccess('Sourcer can call read-only recruiting_find_candidates', safeCall);

const deniedCall = await callTool(sourcerUrl, 'recruiting_schedule_screen', {
  candidate_id: 'candidate-demo-1',
});
assertDenied('Sourcer cannot call recruiting_schedule_screen', deniedCall);

const allowedCall = await callTool(controllerUrl, 'recruiting_schedule_screen', {
  candidate_id: 'candidate-demo-1',
});
assertSuccess('Controller can call identical recruiting_schedule_screen', allowedCall);

process.stdout.write('\nPomerium Core MCP policy smoke test passed.\n');
