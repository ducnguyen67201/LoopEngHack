import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type PomeriumMcpFailureKind =
  'identity_denied' | 'tool_denied' | 'ambiguous_denial' | 'upstream_failure' | 'protocol_error';

export type PomeriumMcpCallOutcome =
  | {
      status: 'success';
      requestId?: string;
      result: CallToolResult;
    }
  | {
      status: 'denied' | 'error';
      kind: PomeriumMcpFailureKind;
      requestId?: string;
      summary: string;
      retriable: boolean;
    };

export interface PomeriumMcpClientOptions {
  routeUrl: string | URL;
  authorizationHeader: string;
  clientName?: string;
  clientVersion?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  allowInsecureHttp?: boolean;
}

interface HttpObservation {
  requestId?: string;
  status: number;
}

const defaultTimeoutMs = 10_000;

function withOptionalRequestId<T extends object>(value: T, requestId: string | undefined): T {
  return requestId === undefined ? value : { ...value, requestId };
}

function sanitizeAuthorizationHeader(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('Bearer Pomerium-') || trimmed.length < 40) {
    throw new Error('Pomerium authorization header is invalid');
  }
  return trimmed;
}

function classifyFailure(
  error: unknown,
  observation: HttpObservation | undefined,
): PomeriumMcpCallOutcome {
  const requestId = observation?.requestId;

  if (observation?.status === 401) {
    return withOptionalRequestId(
      {
        status: 'denied' as const,
        kind: 'identity_denied' as const,
        summary: 'Pomerium rejected the service identity',
        retriable: false,
      },
      requestId,
    );
  }

  if (observation?.status === 403) {
    return withOptionalRequestId(
      {
        status: 'denied' as const,
        kind: 'ambiguous_denial' as const,
        summary: 'The protected route denied the request without MCP tool-policy proof',
        retriable: false,
      },
      requestId,
    );
  }

  // Pomerium's MCP-aware authorization layer returns policy denials as a
  // JSON-RPC error while retaining HTTP 200, so the SDK surfaces an McpError.
  if (
    error instanceof McpError &&
    error.code === -32602 &&
    error.message.startsWith('MCP error -32602: access denied')
  ) {
    return withOptionalRequestId(
      {
        status: 'denied' as const,
        kind: 'tool_denied' as const,
        summary: 'Pomerium denied the MCP tool request',
        retriable: false,
      },
      requestId,
    );
  }

  if (error instanceof McpError || (observation !== undefined && observation.status < 500)) {
    return withOptionalRequestId(
      {
        status: 'error' as const,
        kind: 'protocol_error' as const,
        summary: 'The MCP request failed protocol validation',
        retriable: false,
      },
      requestId,
    );
  }

  return withOptionalRequestId(
    {
      status: 'error' as const,
      kind: 'upstream_failure' as const,
      summary: 'The Pomerium MCP route was unavailable',
      retriable: true,
    },
    requestId,
  );
}

/**
 * Low-level, recruiting-domain-neutral MCP transport. Each call receives a
 * fresh MCP session and call-local HTTP correlation state so concurrent agent
 * requests cannot exchange request IDs or authorization outcomes.
 */
export class PomeriumMcpClient {
  readonly #authorizationHeader: string;
  readonly #baseFetch: typeof globalThis.fetch;
  readonly #clientName: string;
  readonly #clientVersion: string;
  readonly #routeUrl: URL;
  readonly #timeoutMs: number;

  constructor(options: PomeriumMcpClientOptions) {
    this.#routeUrl = new URL(options.routeUrl);
    if (this.#routeUrl.protocol !== 'https:' && options.allowInsecureHttp !== true) {
      throw new Error('Pomerium MCP route must use HTTPS');
    }

    this.#authorizationHeader = sanitizeAuthorizationHeader(options.authorizationHeader);
    this.#timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 60_000) {
      throw new Error('Pomerium MCP timeout must be between 1 and 60000 milliseconds');
    }

    this.#baseFetch = options.fetch ?? globalThis.fetch;
    this.#clientName = options.clientName ?? 'hire-me-if-you-can';
    this.#clientVersion = options.clientVersion ?? '0.1.0';
  }

  async callTool(
    name: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<PomeriumMcpCallOutcome> {
    let httpObservation: HttpObservation | undefined;
    const observedFetch: typeof globalThis.fetch = async (fetchInput, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', this.#authorizationHeader);

      const response = await this.#baseFetch(fetchInput, { ...init, headers });
      const requestId = response.headers.get('x-request-id')?.trim();
      httpObservation = {
        status: response.status,
        ...(requestId === undefined || requestId === '' ? {} : { requestId }),
      };
      return response;
    };
    const client = new Client({ name: this.#clientName, version: this.#clientVersion });
    const transport = new StreamableHTTPClientTransport(this.#routeUrl, { fetch: observedFetch });

    try {
      // SDK 1.29's declarations conflict under exactOptionalPropertyTypes even
      // though the concrete transport implements the runtime contract.
      await client.connect(transport as Transport, { timeout: this.#timeoutMs });
      const result = await client.callTool({ name, arguments: { ...input } }, undefined, {
        timeout: this.#timeoutMs,
      });
      const requestId = httpObservation?.requestId;

      if (result.isError === true) {
        return withOptionalRequestId(
          {
            status: 'error' as const,
            kind: 'protocol_error' as const,
            summary: 'The MCP tool returned an application error',
            retriable: false,
          },
          requestId,
        );
      }

      return withOptionalRequestId(
        { status: 'success' as const, result: result as CallToolResult },
        requestId,
      );
    } catch (error) {
      return classifyFailure(error, httpObservation);
    } finally {
      try {
        await transport.terminateSession();
      } catch {
        // Session cleanup failure must not replace the tool's primary outcome.
      }
      try {
        await client.close();
      } catch {
        // Closing an uninitialized/failed connection is best effort only.
      }
    }
  }

  /** Kept for composition symmetry; calls clean up their own MCP sessions. */
  close(): Promise<void> {
    return Promise.resolve();
  }
}
