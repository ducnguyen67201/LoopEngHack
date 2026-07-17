import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  ZeroAdapterError,
  type ZeroFetchInput,
  type ZeroFetchResult,
  type ZeroSearchOptions,
  type ZeroTransport,
} from './types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export interface CliZeroTransportOptions {
  binary?: string;
  timeoutMs?: number;
  zeroCliVersion?: string;
}

export class CliZeroTransport implements ZeroTransport {
  public readonly binary: string;
  public readonly timeoutMs: number;
  public readonly zeroCliVersion: string | undefined;

  public constructor(options: CliZeroTransportOptions = {}) {
    this.binary = options.binary ?? process.env.ZERO_RUNNER ?? 'zero';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.zeroCliVersion = options.zeroCliVersion;
  }

  public async search(query: string, options: ZeroSearchOptions): Promise<unknown> {
    const args = ['search', query, '--json'];
    if (options.limit !== undefined) args.push('--limit', String(options.limit));
    if (options.maxCostUsd !== undefined) args.push('--max-cost', options.maxCostUsd);
    if (options.freeOnly === true) args.push('--free');
    if (options.status !== undefined) args.push('--status', options.status);
    if (options.protocol !== undefined) args.push('--protocol', options.protocol);
    return this.execJson(args);
  }

  public async version(): Promise<string> {
    const output = await this.execText(['--version']);
    const version = output.trim().slice(0, 80);
    if (version.length === 0) {
      throw new ZeroAdapterError('transport_failed', 'Zero CLI returned an empty version');
    }
    return version;
  }

  public async get(identifier: string): Promise<unknown> {
    return this.execJson(['get', identifier, '--json']);
  }

  public async fetch(input: ZeroFetchInput): Promise<ZeroFetchResult> {
    const args = [
      'fetch',
      '--capability',
      input.capabilityRef,
      '-d',
      JSON.stringify(input.body),
      '--max-pay',
      input.maxPayUsd,
      '--json',
    ];
    if (input.timeoutSeconds !== undefined) args.push('--timeout', String(input.timeoutSeconds));
    return this.execJson(args) as Promise<ZeroFetchResult>;
  }

  private async execJson(args: readonly string[]): Promise<unknown> {
    try {
      const stdout = await this.execText(args);
      return JSON.parse(stdout);
    } catch (error) {
      if (error instanceof ZeroAdapterError) throw error;
      if (error instanceof SyntaxError) {
        throw new ZeroAdapterError('transport_failed', 'Zero CLI returned non-JSON output');
      }
      throw new ZeroAdapterError('transport_failed', 'Zero CLI command failed');
    }
  }

  private async execText(args: readonly string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(this.binary, [...args], {
        timeout: this.timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
      });
      return stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Zero CLI command failed';
      throw new ZeroAdapterError('transport_failed', redactDiagnostics(message));
    }
  }
}

export class FixtureZeroTransport implements ZeroTransport {
  public constructor(
    private readonly fixtures: {
      search?: unknown;
      details?: Record<string, unknown>;
      fetch?: ZeroFetchResult;
    },
  ) {}

  public search(): Promise<unknown> {
    return Promise.resolve(this.fixtures.search ?? { capabilities: [] });
  }

  public get(identifier: string): Promise<unknown> {
    return Promise.resolve(
      this.fixtures.details?.[identifier] ?? { uid: identifier, name: identifier },
    );
  }

  public fetch(): Promise<ZeroFetchResult> {
    return Promise.resolve(
      this.fixtures.fetch ?? {
        runId: null,
        ok: false,
        status: null,
        latencyMs: null,
        payment: null,
        body: null,
        bodyRaw: null,
        error: 'fixture fetch result missing',
      },
    );
  }
}

function redactDiagnostics(message: string): string {
  return message
    .replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/"auth"\s*:\s*"[^"]+"/g, '"auth":"[REDACTED]"');
}
