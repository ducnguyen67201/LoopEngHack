import { createHash } from 'node:crypto';
import { accessSync, constants, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface Attempt {
  body?: CallToolResult;
  error?: string;
  httpStatus?: number;
  requestId?: string;
}

export interface PomeriumCoreSmokeConfiguration {
  readonly controllerUrl: URL;
  readonly evidencePath: string;
  readonly sourcerUrl: URL;
  readonly timeoutMs: number;
}

interface ProofStep {
  readonly actor: 'outbound-sourcer' | 'hiring-controller';
  readonly decision: 'allow' | 'deny';
  readonly httpStatus: number;
  readonly requestId: string;
  readonly route: string;
  readonly tool: typeof protectedTool;
}

interface PomeriumCoreProofEvidence {
  readonly generatedAt: string;
  readonly inputSha256: string;
  readonly prerequisiteProof: {
    readonly controllerRoute: string;
    readonly sourcerRoute: string;
    readonly sourcerReadOnlyCall: 'allow';
  };
  readonly proofType: 'pomerium-core-mcp-same-tool-policy';
  readonly sameInput: true;
  readonly sameTool: true;
  readonly steps: readonly [ProofStep, ProofStep];
  readonly tool: typeof protectedTool;
}

const defaultSourcerUrl = 'https://sourcer-mcp.localhost.pomerium.io:8443';
const defaultControllerUrl = 'https://controller-mcp.localhost.pomerium.io:8443';
const protectedTool = 'recruiting_schedule_screen';
const protectedInput = { candidate_id: 'candidate-demo-1' } as const;
const expectedProtectedResult = 'scheduled:candidate-demo-1:synthetic-calendar';

function withHttpObservation(
  attempt: Attempt,
  httpStatus: number | undefined,
  requestId: string | undefined,
): Attempt {
  return {
    ...attempt,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

async function callTool(
  routeUrl: URL,
  tool: string,
  input: Readonly<Record<string, unknown>>,
  timeoutMs: number,
): Promise<Attempt> {
  let httpStatus: number | undefined;
  let requestId: string | undefined;
  const observedFetch: typeof globalThis.fetch = async (request, init) => {
    const response = await fetch(request, init);
    httpStatus = response.status;
    const observedRequestId = response.headers.get('x-request-id')?.trim();
    if (observedRequestId !== undefined && observedRequestId !== '') {
      requestId = observedRequestId;
    }
    return response;
  };
  const client = new Client({ name: 'pomerium-core-smoke-verifier', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(routeUrl, { fetch: observedFetch });

  try {
    await client.connect(transport as Transport, { timeout: timeoutMs });
    const body = (await client.callTool({ name: tool, arguments: { ...input } }, undefined, {
      timeout: timeoutMs,
    })) as CallToolResult;
    return withHttpObservation({ body }, httpStatus, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown MCP client failure';
    return withHttpObservation({ error: message }, httpStatus, requestId);
  } finally {
    await transport.terminateSession().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

function assertSuccess(
  label: string,
  attempt: Attempt,
  expectedText: string,
): { httpStatus: number; requestId: string } {
  const responseContainsExpectedResult = attempt.body?.content.some(
    (item) => item.type === 'text' && item.text === expectedText,
  );
  if (
    attempt.httpStatus !== 200 ||
    attempt.error !== undefined ||
    attempt.body?.isError === true ||
    responseContainsExpectedResult !== true
  ) {
    throw new Error(`${label} should execute successfully, received ${JSON.stringify(attempt)}`);
  }
  const requestId = requireRequestId(label, attempt);
  process.stdout.write(`PASS  ${label} -> HTTP 200 (request ${requestId})\n`);
  return { httpStatus: 200, requestId };
}

function assertDenied(label: string, attempt: Attempt): { httpStatus: number; requestId: string } {
  const isPomeriumMcpDenial =
    attempt.httpStatus === 200 &&
    attempt.error?.includes('MCP error -32602: access denied') === true;
  if (!isPomeriumMcpDenial) {
    throw new Error(
      `${label} should return Pomerium's MCP access-denied error, received ${JSON.stringify(attempt)}`,
    );
  }
  const requestId = requireRequestId(label, attempt);
  process.stdout.write(`PASS  ${label} -> MCP access denied (request ${requestId})\n`);
  return { httpStatus: 200, requestId };
}

function requireRequestId(label: string, attempt: Attempt): string {
  const fromError = attempt.error?.match(/request ([A-Za-z0-9._:-]{1,96})/)?.[1];
  const requestId = attempt.requestId ?? fromError;
  if (requestId === undefined) {
    throw new Error(`${label} produced no request ID for authorization-log correlation`);
  }
  return requestId;
}

export function loadPomeriumCoreSmokeConfiguration(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): PomeriumCoreSmokeConfiguration {
  const sourcerUrl = protectedRouteUrl(
    environment.SOURCER_CORE_SMOKE_URL ?? defaultSourcerUrl,
    'SOURCER_CORE_SMOKE_URL',
  );
  const controllerUrl = protectedRouteUrl(
    environment.CONTROLLER_CORE_SMOKE_URL ?? defaultControllerUrl,
    'CONTROLLER_CORE_SMOKE_URL',
  );
  if (sourcerUrl.href === controllerUrl.href) {
    throw new Error('Sourcer and Controller smoke routes must be distinct');
  }

  if (isLocalPomeriumRoute(sourcerUrl) || isLocalPomeriumRoute(controllerUrl)) {
    const caPath = environment.NODE_EXTRA_CA_CERTS?.trim();
    if (caPath === undefined || caPath === '') {
      throw new Error(
        'NODE_EXTRA_CA_CERTS must point to .pomerium/core-ca.pem for the local TLS proof',
      );
    }
    const resolvedCaPath = resolve(caPath);
    try {
      accessSync(resolvedCaPath, constants.R_OK);
      if (!statSync(resolvedCaPath).isFile()) throw new Error('not a file');
    } catch {
      throw new Error(`NODE_EXTRA_CA_CERTS is not a readable file: ${resolvedCaPath}`);
    }
  }

  const timeoutMs = parseTimeout(environment.POMERIUM_SMOKE_TIMEOUT_MS);
  const evidencePath = resolve(
    environment.POMERIUM_SMOKE_EVIDENCE_PATH ?? '.pomerium/pomerium-core-proof.json',
  );
  return { controllerUrl, evidencePath, sourcerUrl, timeoutMs };
}

function protectedRouteUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(`${name} must be a credential-free HTTPS route URL`);
  }
  return url;
}

function isLocalPomeriumRoute(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname.endsWith('.localhost.pomerium.io');
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return 10_000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60_000) {
    throw new Error('POMERIUM_SMOKE_TIMEOUT_MS must be an integer between 1 and 60000');
  }
  return parsed;
}

export async function runPomeriumCoreSmoke(
  configuration: PomeriumCoreSmokeConfiguration,
): Promise<PomeriumCoreProofEvidence> {
  const safeCall = await callTool(
    configuration.sourcerUrl,
    'recruiting_find_candidates',
    { query: 'platform engineer' },
    configuration.timeoutMs,
  );
  assertSuccess(
    'Sourcer can call read-only recruiting_find_candidates',
    safeCall,
    'candidate-demo-1',
  );

  const deniedCall = await callTool(
    configuration.sourcerUrl,
    protectedTool,
    protectedInput,
    configuration.timeoutMs,
  );
  const denied = assertDenied(`Sourcer cannot call ${protectedTool}`, deniedCall);

  const allowedCall = await callTool(
    configuration.controllerUrl,
    protectedTool,
    protectedInput,
    configuration.timeoutMs,
  );
  const allowed = assertSuccess(
    `Controller can call identical ${protectedTool}`,
    allowedCall,
    expectedProtectedResult,
  );

  return {
    generatedAt: new Date().toISOString(),
    inputSha256: createHash('sha256').update(JSON.stringify(protectedInput)).digest('hex'),
    prerequisiteProof: {
      controllerRoute: configuration.controllerUrl.origin,
      sourcerRoute: configuration.sourcerUrl.origin,
      sourcerReadOnlyCall: 'allow',
    },
    proofType: 'pomerium-core-mcp-same-tool-policy',
    sameInput: true,
    sameTool: true,
    steps: [
      {
        actor: 'outbound-sourcer',
        decision: 'deny',
        httpStatus: denied.httpStatus,
        requestId: denied.requestId,
        route: configuration.sourcerUrl.origin,
        tool: protectedTool,
      },
      {
        actor: 'hiring-controller',
        decision: 'allow',
        httpStatus: allowed.httpStatus,
        requestId: allowed.requestId,
        route: configuration.controllerUrl.origin,
        tool: protectedTool,
      },
    ],
    tool: protectedTool,
  };
}

export function writePomeriumCoreProof(
  evidencePath: string,
  evidence: PomeriumCoreProofEvidence,
): void {
  mkdirSync(dirname(evidencePath), { recursive: true, mode: 0o700 });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}

async function main(): Promise<void> {
  const configuration = loadPomeriumCoreSmokeConfiguration();
  const evidence = await runPomeriumCoreSmoke(configuration);
  writePomeriumCoreProof(configuration.evidencePath, evidence);
  process.stdout.write(`\nPomerium Core MCP policy smoke test passed.\n`);
  process.stdout.write(`Evidence written to ${configuration.evidencePath}\n`);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
