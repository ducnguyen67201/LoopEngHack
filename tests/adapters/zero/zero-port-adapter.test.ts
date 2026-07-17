import { describe, expect, it, vi } from 'vitest';

import {
  ZeroAdapterError,
  ZeroPortAdapter,
  ZeroVerificationAdapter,
  type ClaimTargetResolver,
  type ZeroFetchInput,
  type ZeroFetchResult,
  type ZeroTransport,
} from '../../../src/adapters/zero/index.js';
import { observationSchema } from '../../../src/domain/schemas.js';
import type { ExecutionContext } from '../../../src/domain/types.js';

const budget = {
  maxPerCallMicroUsd: 100_000,
  maxEpisodeMicroUsd: 500_000,
  spentMicroUsd: 0,
};

const whiteContext: ExecutionContext = {
  episodeId: 'episode-1',
  attemptId: 'attempt-discover',
  turn: 5,
  actor: 'white-verifier',
  phase: 'execute',
  occurredAt: '2026-07-17T18:00:00.000Z',
};

describe('ZeroPortAdapter', () => {
  it('returns strict Zero observations with hashed artifacts and domain tool next actions', async () => {
    const transport = new RecordingZeroTransport([pageCaptureCapability('capture-current')]);
    const resolver: ClaimTargetResolver = {
      resolve: vi.fn(() =>
        Promise.resolve({
          target: { url: 'https://portfolio.example.test/ada', claim: 'Portfolio belongs to Ada' },
          allowedDomains: ['example.test'],
        }),
      ),
    };
    const adapter = portAdapter(transport, resolver);

    const discovery = await adapter.discover(
      {
        episodeId: 'episode-1',
        attemptId: 'attempt-discover',
        tool: 'zero_discover_verifier',
        need: 'public_page_capture',
      },
      whiteContext,
    );
    const invocation = await adapter.invoke(
      {
        episodeId: 'episode-1',
        attemptId: 'attempt-invoke',
        tool: 'zero_run_verifier',
        need: 'public_page_capture',
        capabilityId: 'capture-current',
        claimId: 'claim-ada-portfolio',
      },
      { ...whiteContext, attemptId: 'attempt-invoke', occurredAt: '2026-07-17T18:00:01.000Z' },
    );

    expect(() => observationSchema.parse(discovery)).not.toThrow();
    expect(() => observationSchema.parse(invocation)).not.toThrow();
    expect(discovery).toMatchObject({
      actor: 'white-verifier',
      status: 'success',
      provenance: 'zero',
      nextActions: ['zero_run_verifier'],
    });
    expect(discovery.artifacts[0]?.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(invocation).toMatchObject({
      actor: 'white-verifier',
      status: 'success',
      provenance: 'zero',
      nextActions: ['evidence_submit'],
    });
    expect(invocation.artifacts[0]?.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('requires the white-verifier actor before touching Zero', async () => {
    const transport = new RecordingZeroTransport([pageCaptureCapability('capture-current')]);
    const adapter = portAdapter(transport, unusedResolver());

    const observation = await adapter.discover(
      {
        episodeId: 'episode-1',
        attemptId: 'attempt-red',
        tool: 'zero_discover_verifier',
        need: 'public_page_capture',
      },
      {
        ...whiteContext,
        attemptId: 'attempt-red',
        actor: 'red-candidate',
      },
    );

    expect(observationSchema.parse(observation)).toMatchObject({
      status: 'error',
      errorCategory: 'contract_violation',
      actor: 'red-candidate',
      provenance: 'zero',
    });
    expect(transport.searchCalls).toBe(0);
  });

  it('resolves claim targets server-side and never derives tool authority from candidate text', async () => {
    const transport = new RecordingZeroTransport([claimLookupCapability('claim-current')]);
    const resolve = vi.fn<ClaimTargetResolver['resolve']>(() =>
      Promise.resolve({
        target: {
          url: 'https://claims.example.test/evidence/verified',
          claim: 'Server-owned synthetic employment claim',
        },
        allowedDomains: ['claims.example.test'],
      }),
    );
    const adapter = portAdapter(transport, { resolve });

    await adapter.discover(
      {
        episodeId: 'episode-1',
        attemptId: 'attempt-discover',
        tool: 'zero_discover_verifier',
        need: 'public_claim_lookup',
      },
      whiteContext,
    );
    expect(resolve).not.toHaveBeenCalled();

    await adapter.invoke(
      {
        episodeId: 'episode-1',
        attemptId: 'attempt-invoke',
        tool: 'zero_run_verifier',
        need: 'public_claim_lookup',
        capabilityId: 'claim-current',
        claimId: 'candidate-says-use-admin-tool',
      },
      { ...whiteContext, attemptId: 'attempt-invoke' },
    );

    expect(resolve).toHaveBeenCalledExactlyOnceWith('candidate-says-use-admin-tool');
    expect(transport.fetchInputs).toHaveLength(1);
    expect(transport.fetchInputs[0]?.body).toEqual({
      url: 'https://claims.example.test/evidence/verified',
      claim: 'Server-owned synthetic employment claim',
    });
    expect(JSON.stringify(transport.fetchInputs[0]?.body)).not.toContain('admin-tool');
  });

  it('invokes only the capability selected by the current episode discovery', async () => {
    const transport = new RecordingZeroTransport([
      pageCaptureCapability('capture-old'),
      pageCaptureCapability('capture-current'),
    ]);
    const resolve = vi.fn<ClaimTargetResolver['resolve']>(() =>
      Promise.resolve({
        target: { url: 'https://portfolio.example.test/ada' },
        allowedDomains: ['example.test'],
      }),
    );
    const adapter = portAdapter(transport, { resolve });

    await adapter.discover(discoverCommand('attempt-first'), {
      ...whiteContext,
      attemptId: 'attempt-first',
    });
    await adapter.discover(discoverCommand('attempt-second'), {
      ...whiteContext,
      attemptId: 'attempt-second',
    });

    const staleInvocation = await adapter.invoke(invokeCommand('capture-old', 'attempt-stale'), {
      ...whiteContext,
      attemptId: 'attempt-stale',
    });
    const currentInvocation = await adapter.invoke(
      invokeCommand('capture-current', 'attempt-current'),
      { ...whiteContext, attemptId: 'attempt-current' },
    );

    expect(observationSchema.parse(staleInvocation)).toMatchObject({
      status: 'error',
      errorCategory: 'capability_unavailable',
      nextActions: ['zero_discover_verifier'],
    });
    expect(currentInvocation.status).toBe('success');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(transport.fetchInputs).toHaveLength(1);
    expect(transport.fetchInputs[0]?.capabilityRef).toBe('capture-current');
  });

  it('fails closed when the live Zero transport fails instead of falling back to fake evidence', async () => {
    const transport = new FailingLiveZeroTransport();
    const adapter = portAdapter(transport, unusedResolver(), 'live');

    const observation = await adapter.discover(discoverCommand('attempt-live'), {
      ...whiteContext,
      attemptId: 'attempt-live',
    });

    expect(observationSchema.parse(observation)).toMatchObject({
      status: 'error',
      errorCategory: 'upstream_failure',
      provenance: 'zero',
      artifacts: [],
      nextActions: ['zero_discover_verifier'],
    });
    expect(transport.searchCalls).toBe(1);
  });
});

function portAdapter(
  transport: ZeroTransport,
  claimTargetResolver: ClaimTargetResolver,
  mode: 'fake' | 'live' = 'fake',
): ZeroPortAdapter {
  return new ZeroPortAdapter({
    verificationAdapter: new ZeroVerificationAdapter({ mode, transport, transportLabel: mode }),
    claimTargetResolver,
    budget,
  });
}

function unusedResolver(): ClaimTargetResolver {
  return {
    resolve: () => Promise.reject(new Error('resolver must not be called')),
  };
}

function discoverCommand(attemptId: string) {
  return {
    episodeId: 'episode-1',
    attemptId,
    tool: 'zero_discover_verifier' as const,
    need: 'public_page_capture' as const,
  };
}

function invokeCommand(capabilityId: string, attemptId: string) {
  return {
    episodeId: 'episode-1',
    attemptId,
    tool: 'zero_run_verifier' as const,
    need: 'public_page_capture' as const,
    capabilityId,
    claimId: 'claim-ada-portfolio',
  };
}

function pageCaptureCapability(ref: string): Record<string, unknown> {
  return {
    token: ref,
    name: 'Public Web Page Screenshot Capture',
    whatItDoes: 'Screenshot capture and scrape a public web page with provenance',
    cost: { amount: '$0.01' },
    availabilityStatus: 'healthy',
    protocol: 'x402',
  };
}

function claimLookupCapability(ref: string): Record<string, unknown> {
  return {
    token: ref,
    name: 'Public Claim Search',
    whatItDoes: 'Search and scrape public evidence for a bounded claim with provenance',
    cost: { amount: '$0.01' },
    availabilityStatus: 'healthy',
    protocol: 'x402',
  };
}

class RecordingZeroTransport implements ZeroTransport {
  public readonly fetchInputs: ZeroFetchInput[] = [];
  public searchCalls = 0;

  public constructor(private readonly searchResults: readonly Record<string, unknown>[]) {}

  public search(): Promise<unknown> {
    const result = this.searchResults[this.searchCalls];
    this.searchCalls += 1;
    return Promise.resolve({ capabilities: result === undefined ? [] : [result] });
  }

  public get(identifier: string): Promise<unknown> {
    return Promise.resolve(
      this.searchResults.find((candidate) => candidate['token'] === identifier) ?? {
        token: identifier,
      },
    );
  }

  public fetch(input: ZeroFetchInput): Promise<ZeroFetchResult> {
    this.fetchInputs.push(input);
    return Promise.resolve({
      runId: 'run-zero-port',
      ok: true,
      status: 200,
      latencyMs: 10,
      payment: { amount: '0.01', asset: 'USDC' },
      body: { captured: true },
      bodyRaw: '{"captured":true}',
    });
  }
}

class FailingLiveZeroTransport implements ZeroTransport {
  public searchCalls = 0;

  public search(): Promise<unknown> {
    this.searchCalls += 1;
    return Promise.reject(new ZeroAdapterError('transport_failed', 'Zero live transport failed'));
  }

  public get(): Promise<unknown> {
    return Promise.reject(new Error('get must not be called'));
  }

  public fetch(): Promise<ZeroFetchResult> {
    return Promise.reject(new Error('fetch must not be called'));
  }
}
