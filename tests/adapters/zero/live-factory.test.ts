import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ZeroAdapterError,
  createLiveZeroPort,
  type ClaimTargetResolver,
  type LiveZeroPortOptions,
} from '../../../src/adapters/zero/index.js';
import type { ExecutionContext } from '../../../src/domain/types.js';

const fixtureBinary = fileURLToPath(new URL('./fixtures/zero-cli.ts', import.meta.url));

const context: ExecutionContext = {
  episodeId: 'episode-live',
  attemptId: 'attempt-discover',
  turn: 5,
  actor: 'white-verifier',
  phase: 'execute',
  occurredAt: '2026-07-17T18:00:00.000Z',
};

describe('createLiveZeroPort', () => {
  it('constructs the CLI-backed live port and reports an honest discovery-only probe', async () => {
    const runtime = createLiveZeroPort(options());

    const probe = await runtime.probe();

    expect(probe).toMatchObject({
      mode: 'live',
      transport: 'zero-cli',
      fallback: 'disabled',
      status: 'ready_for_discovery',
      cliVersion: '1.26.0',
      discovery: { status: 'ready', capabilityRef: 'capture-allowed' },
      invocation: {
        status: 'not_tested',
        reason: 'Startup probe does not perform paid capability invocations.',
      },
    });
  });

  it('never selects capabilities outside the explicit reference allowlist', async () => {
    const runtime = createLiveZeroPort(
      options({ allowedCapabilityRefs: ['some-other-capability'] }),
    );

    const probe = await runtime.probe();
    const discovery = await runtime.port.discover(discoverCommand(), context);

    expect(probe).toMatchObject({
      status: 'not_ready',
      discovery: { status: 'not_ready' },
      invocation: { status: 'not_tested' },
    });
    expect(discovery).toMatchObject({
      status: 'error',
      errorCategory: 'capability_unavailable',
      artifacts: [],
    });
  });

  it('normalizes an allowlisted UID to the capability token used by get and fetch', async () => {
    const runtime = createLiveZeroPort(options({ allowedCapabilityRefs: ['capture-uid'] }));

    const discovery = await runtime.port.discover(discoverCommand(), context);
    const capabilityId = stringFact(discovery, 'capability_id') ?? '';
    const invocation = await runtime.port.invoke(invokeCommand(capabilityId, 'attempt-uid'), {
      ...context,
      attemptId: 'attempt-uid',
    });

    expect(capabilityId).toBe('capture-allowed');
    expect(invocation.status).toBe('success');
  });

  it('enforces the configured target-domain allowlist before invoking Zero', async () => {
    const runtime = createLiveZeroPort(
      options({
        claimTargetResolver: resolver('https://outside.example/ada', ['outside.example']),
      }),
    );
    const discovery = await runtime.port.discover(discoverCommand(), context);
    const capabilityId = stringFact(discovery, 'capability_id');

    const invocation = await runtime.port.invoke(
      invokeCommand(capabilityId ?? '', 'attempt-outside'),
      { ...context, attemptId: 'attempt-outside' },
    );

    expect(invocation).toMatchObject({
      status: 'error',
      errorCategory: 'invalid_evidence',
      artifacts: [],
    });
  });

  it('reserves declared spend and blocks calls beyond the hard runtime cap', async () => {
    const runtime = createLiveZeroPort(
      options({ maxPerCallMicroUsd: 10_000, maxEpisodeMicroUsd: 15_000 }),
    );
    const discovery = await runtime.port.discover(discoverCommand(), context);
    const capabilityId = stringFact(discovery, 'capability_id') ?? '';

    const first = await runtime.port.invoke(invokeCommand(capabilityId, 'attempt-first'), {
      ...context,
      attemptId: 'attempt-first',
    });
    const second = await runtime.port.invoke(invokeCommand(capabilityId, 'attempt-second'), {
      ...context,
      attemptId: 'attempt-second',
    });

    expect(first.status).toBe('success');
    expect(second).toMatchObject({
      status: 'error',
      errorCategory: 'budget_exceeded',
      artifacts: [],
    });
  });

  it('enforces one cumulative spend ceiling across learning-loop episodes', async () => {
    const runtime = createLiveZeroPort(
      options({ maxPerCallMicroUsd: 10_000, maxEpisodeMicroUsd: 15_000 }),
    );
    const firstDiscovery = await runtime.port.discover(discoverCommand('episode-one'), {
      ...context,
      episodeId: 'episode-one',
    });
    const firstCapabilityId = stringFact(firstDiscovery, 'capability_id') ?? '';
    const first = await runtime.port.invoke(
      invokeCommand(firstCapabilityId, 'attempt-one', 'episode-one'),
      { ...context, episodeId: 'episode-one', attemptId: 'attempt-one' },
    );

    const secondDiscovery = await runtime.port.discover(discoverCommand('episode-two'), {
      ...context,
      episodeId: 'episode-two',
    });

    expect(first.status).toBe('success');
    expect(secondDiscovery).toMatchObject({
      status: 'error',
      errorCategory: 'capability_unavailable',
    });
  });

  it('fails configuration closed instead of constructing a fake fallback', () => {
    expect(() => createLiveZeroPort(options({ allowedCapabilityRefs: [] }))).toThrow(
      ZeroAdapterError,
    );
    expect(() =>
      createLiveZeroPort(options({ maxPerCallMicroUsd: 20_000, maxEpisodeMicroUsd: 10_000 })),
    ).toThrow(/per-call budget cannot exceed episode budget/);
    expect(() => createLiveZeroPort(options({ allowedTargetDomains: ['*'] }))).toThrow(
      /target domain allowlist/,
    );
  });

  it('returns sanitized not-ready diagnostics when the CLI cannot start', async () => {
    const secretPath = '/missing/zero-Bearer-secret-token';
    const runtime = createLiveZeroPort(options({ binary: secretPath }));

    const probe = await runtime.probe();

    expect(probe).toMatchObject({
      status: 'not_ready',
      fallback: 'disabled',
      discovery: { status: 'not_ready' },
      invocation: { status: 'not_tested' },
    });
    expect(JSON.stringify(probe)).not.toContain(secretPath);
    expect(JSON.stringify(probe)).not.toContain('secret-token');
  });
});

function options(overrides: Partial<LiveZeroPortOptions> = {}): LiveZeroPortOptions {
  return {
    binary: fixtureBinary,
    timeoutMs: 5_000,
    allowedCapabilityRefs: ['capture-allowed'],
    allowedTargetDomains: ['portfolio.example.test'],
    maxPerCallMicroUsd: 10_000,
    maxEpisodeMicroUsd: 20_000,
    claimTargetResolver: resolver('https://portfolio.example.test/ada', ['portfolio.example.test']),
    ...overrides,
  };
}

function resolver(url: string, allowedDomains: readonly string[]): ClaimTargetResolver {
  return {
    resolve: () => Promise.resolve({ target: { url }, allowedDomains }),
  };
}

function discoverCommand(episodeId = 'episode-live') {
  return {
    episodeId,
    attemptId: 'attempt-discover',
    tool: 'zero_discover_verifier' as const,
    need: 'public_page_capture' as const,
  };
}

function invokeCommand(capabilityId: string, attemptId: string, episodeId = 'episode-live') {
  return {
    episodeId,
    attemptId,
    tool: 'zero_run_verifier' as const,
    need: 'public_page_capture' as const,
    capabilityId,
    claimId: 'claim-live-smoke',
  };
}

function stringFact(
  observation: Awaited<ReturnType<ReturnType<typeof createLiveZeroPort>['port']['discover']>>,
  key: string,
): string | null {
  const value = observation.facts.find((candidate) => candidate.key === key)?.value;
  return typeof value === 'string' ? value : null;
}
