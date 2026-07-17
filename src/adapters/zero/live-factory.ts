import { isIP } from 'node:net';

import type { ZeroPort } from '../../domain/ports.js';
import { assertSafePublicUrl } from './policy.js';
import { CliZeroTransport } from './transport.js';
import {
  ZeroAdapterError,
  type VerificationNeed,
  type ZeroBudget,
  type ZeroSearchOptions,
  type ZeroTransport,
} from './types.js';
import {
  ZeroPortAdapter,
  type ClaimTarget,
  type ClaimTargetResolver,
} from './zero-port-adapter.js';
import { ZeroVerificationAdapter } from './zero-verification-adapter.js';

const MAX_TIMEOUT_MS = 120_000;
const CAPABILITY_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

type ProbeNeed = Extract<VerificationNeed, 'public_page_capture' | 'public_claim_lookup'>;

export interface LiveZeroPortOptions {
  readonly binary: string;
  readonly timeoutMs: number;
  readonly allowedCapabilityRefs: readonly string[];
  readonly allowedTargetDomains: readonly string[];
  readonly maxPerCallMicroUsd: number;
  readonly maxEpisodeMicroUsd: number;
  readonly initialSpentMicroUsd?: number;
  readonly claimTargetResolver: ClaimTargetResolver;
  readonly discoveryDetailLimit?: number;
  readonly probeNeed?: ProbeNeed;
}

export interface ZeroStartupProbe {
  readonly mode: 'live';
  readonly transport: 'zero-cli';
  readonly fallback: 'disabled';
  readonly status: 'ready_for_discovery' | 'not_ready';
  readonly checkedAt: string;
  readonly cliVersion: string | null;
  readonly discovery:
    | {
        readonly status: 'ready';
        readonly need: ProbeNeed;
        readonly capabilityRef: string;
      }
    | {
        readonly status: 'not_ready';
        readonly need: ProbeNeed;
        readonly reason: 'transport_unavailable' | 'no_allowlisted_capability';
      };
  readonly invocation: {
    readonly status: 'not_tested';
    readonly reason: 'Startup probe does not perform paid capability invocations.';
  };
}

export interface LiveZeroPortRuntime {
  readonly port: ZeroPort;
  readonly probe: () => Promise<ZeroStartupProbe>;
}

export type LiveZeroProbe = ZeroStartupProbe;
export type LiveZeroRuntime = LiveZeroPortRuntime;

/** Constructs the live-only Zero port. This factory has no fake or recorded fallback path. */
export function createLiveZeroPort(options: LiveZeroPortOptions): LiveZeroPortRuntime {
  const validated = validateOptions(options);
  const cliTransport = new CliZeroTransport({
    binary: validated.binary,
    timeoutMs: validated.timeoutMs,
  });
  const transport = new AllowlistedZeroTransport(cliTransport, validated.allowedCapabilityRefs);
  const verificationAdapter = new ZeroVerificationAdapter({
    mode: 'live',
    transport,
    transportLabel: 'zero-cli',
    allowedCapabilityRefs: validated.allowedCapabilityRefs,
    ...(validated.discoveryDetailLimit === undefined
      ? {}
      : { discoveryDetailLimit: validated.discoveryDetailLimit }),
  });
  const port = new ZeroPortAdapter({
    verificationAdapter,
    claimTargetResolver: new AllowlistedClaimTargetResolver(
      validated.claimTargetResolver,
      validated.allowedTargetDomains,
    ),
    budget: validated.budget,
    budgetScope: 'runtime',
  });

  return {
    port,
    probe: async () =>
      probeLiveZero({
        cliTransport,
        verificationAdapter,
        budget: validated.budget,
        need: validated.probeNeed,
      }),
  };
}

interface ValidatedOptions {
  readonly binary: string;
  readonly timeoutMs: number;
  readonly allowedCapabilityRefs: readonly string[];
  readonly allowedTargetDomains: readonly string[];
  readonly claimTargetResolver: ClaimTargetResolver;
  readonly discoveryDetailLimit: number | undefined;
  readonly probeNeed: ProbeNeed;
  readonly budget: ZeroBudget;
}

function validateOptions(options: LiveZeroPortOptions): ValidatedOptions {
  const binary = options.binary.trim();
  if (binary.length === 0) configurationError('Zero CLI binary must be explicit');
  assertPositiveInteger(options.timeoutMs, 'Zero CLI timeout');
  if (options.timeoutMs > MAX_TIMEOUT_MS) {
    configurationError(`Zero CLI timeout must not exceed ${MAX_TIMEOUT_MS}ms`);
  }

  const allowedCapabilityRefs = unique(options.allowedCapabilityRefs.map((ref) => ref.trim()));
  if (
    allowedCapabilityRefs.length === 0 ||
    allowedCapabilityRefs.some((ref) => !CAPABILITY_REF_PATTERN.test(ref))
  ) {
    configurationError('Zero capability reference allowlist must contain bounded identifiers');
  }

  const allowedTargetDomains = unique(
    options.allowedTargetDomains.map((domain) => domain.trim().toLowerCase()),
  );
  if (
    allowedTargetDomains.length === 0 ||
    allowedTargetDomains.some(
      (domain) =>
        !DOMAIN_PATTERN.test(domain) ||
        isIP(domain) !== 0 ||
        domain === 'localhost' ||
        domain.endsWith('.localhost'),
    )
  ) {
    configurationError('Zero target domain allowlist must contain explicit public hostnames');
  }

  assertPositiveInteger(options.maxPerCallMicroUsd, 'Zero per-call budget');
  assertPositiveInteger(options.maxEpisodeMicroUsd, 'Zero episode budget');
  if (options.maxPerCallMicroUsd > options.maxEpisodeMicroUsd) {
    configurationError('Zero per-call budget cannot exceed episode budget');
  }
  const initialSpentMicroUsd = options.initialSpentMicroUsd ?? 0;
  if (!Number.isInteger(initialSpentMicroUsd) || initialSpentMicroUsd < 0) {
    configurationError('Zero initial spend must be a non-negative integer');
  }
  if (initialSpentMicroUsd > options.maxEpisodeMicroUsd) {
    configurationError('Zero initial spend cannot exceed episode budget');
  }
  if (
    options.discoveryDetailLimit !== undefined &&
    (!Number.isInteger(options.discoveryDetailLimit) ||
      options.discoveryDetailLimit < 0 ||
      options.discoveryDetailLimit > 20)
  ) {
    configurationError('Zero discovery detail limit must be an integer between 0 and 20');
  }

  return {
    binary,
    timeoutMs: options.timeoutMs,
    allowedCapabilityRefs,
    allowedTargetDomains,
    claimTargetResolver: options.claimTargetResolver,
    discoveryDetailLimit: options.discoveryDetailLimit,
    probeNeed: options.probeNeed ?? 'public_page_capture',
    budget: {
      maxPerCallMicroUsd: options.maxPerCallMicroUsd,
      maxEpisodeMicroUsd: options.maxEpisodeMicroUsd,
      spentMicroUsd: initialSpentMicroUsd,
    },
  };
}

async function probeLiveZero(input: {
  cliTransport: CliZeroTransport;
  verificationAdapter: ZeroVerificationAdapter;
  budget: ZeroBudget;
  need: ProbeNeed;
}): Promise<ZeroStartupProbe> {
  const checkedAt = new Date().toISOString();
  const invocation = {
    status: 'not_tested' as const,
    reason: 'Startup probe does not perform paid capability invocations.' as const,
  };
  let cliVersion: string | null = null;

  try {
    cliVersion = await input.cliTransport.version();
    const discovery = await input.verificationAdapter.discover({
      episodeId: 'zero-startup-probe',
      attemptId: 'zero-startup-probe',
      need: input.need,
      target: {},
      allowedDomains: [],
      budget: input.budget,
      now: checkedAt,
    });
    if (discovery.selected === null) {
      return {
        mode: 'live',
        transport: 'zero-cli',
        fallback: 'disabled',
        status: 'not_ready',
        checkedAt,
        cliVersion,
        discovery: {
          status: 'not_ready',
          need: input.need,
          reason: 'no_allowlisted_capability',
        },
        invocation,
      };
    }
    return {
      mode: 'live',
      transport: 'zero-cli',
      fallback: 'disabled',
      status: 'ready_for_discovery',
      checkedAt,
      cliVersion,
      discovery: {
        status: 'ready',
        need: input.need,
        capabilityRef: discovery.selected.ref,
      },
      invocation,
    };
  } catch {
    return {
      mode: 'live',
      transport: 'zero-cli',
      fallback: 'disabled',
      status: 'not_ready',
      checkedAt,
      cliVersion,
      discovery: { status: 'not_ready', need: input.need, reason: 'transport_unavailable' },
      invocation,
    };
  }
}

class AllowlistedZeroTransport implements ZeroTransport {
  private readonly allowedRefs: ReadonlySet<string>;
  private readonly discoveredRefs: Set<string>;

  public constructor(
    private readonly base: ZeroTransport,
    allowedCapabilityRefs: readonly string[],
  ) {
    this.allowedRefs = new Set(allowedCapabilityRefs);
    this.discoveredRefs = new Set(allowedCapabilityRefs);
  }

  public async search(query: string, options: ZeroSearchOptions): Promise<unknown> {
    const filtered = filterCapabilities(await this.base.search(query, options), this.allowedRefs);
    this.rememberAliases(filtered);
    return filtered;
  }

  public async get(identifier: string): Promise<unknown> {
    this.requireDiscoveredReference(identifier);
    const detail = await this.base.get(identifier);
    this.rememberAliases(detail);
    return detail;
  }

  public fetch(input: Parameters<ZeroTransport['fetch']>[0]) {
    this.requireDiscoveredReference(input.capabilityRef);
    return this.base.fetch(input);
  }

  private requireDiscoveredReference(reference: string): void {
    if (!this.discoveredRefs.has(reference)) {
      throw new ZeroAdapterError('capability_unavailable', 'Zero capability is not allowlisted');
    }
  }

  private rememberAliases(raw: unknown): void {
    for (const candidate of capabilityRecords(raw)) {
      for (const reference of referencesOf(candidate)) this.discoveredRefs.add(reference);
    }
  }
}

class AllowlistedClaimTargetResolver implements ClaimTargetResolver {
  public constructor(
    private readonly delegate: ClaimTargetResolver,
    private readonly globalAllowedDomains: readonly string[],
  ) {}

  public async resolve(claimId: string): Promise<ClaimTarget> {
    const resolved = await this.delegate.resolve(claimId);
    if (resolved.target.url === undefined) {
      throw new ZeroAdapterError('invalid_target', 'resolved Zero target requires a public URL');
    }
    const approvedUrl = assertSafePublicUrl(resolved.target.url, this.globalAllowedDomains);
    assertSafePublicUrl(resolved.target.url, resolved.allowedDomains);
    return {
      target: resolved.target,
      allowedDomains: [approvedUrl.hostname],
    };
  }
}

function filterCapabilities(raw: unknown, allowedRefs: ReadonlySet<string>): unknown {
  if (Array.isArray(raw)) return raw.filter((item) => hasAllowedReference(item, allowedRefs));
  if (isRecord(raw) && Array.isArray(raw['capabilities'])) {
    return {
      ...raw,
      capabilities: raw['capabilities'].filter((item) => hasAllowedReference(item, allowedRefs)),
    };
  }
  if (isRecord(raw) && Array.isArray(raw['data'])) {
    return {
      ...raw,
      data: raw['data'].filter((item) => hasAllowedReference(item, allowedRefs)),
    };
  }
  return raw;
}

function hasAllowedReference(value: unknown, allowedRefs: ReadonlySet<string>): boolean {
  return referencesOf(value).some((reference) => allowedRefs.has(reference));
}

function referencesOf(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return unique(
    ['token', 'uid', 'id', 'slug']
      .map((key) => value[key])
      .filter((reference): reference is string =>
        typeof reference === 'string' ? reference.trim().length > 0 : false,
      ),
  );
}

function capabilityRecords(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!isRecord(raw)) return [];
  if (Array.isArray(raw['capabilities'])) return raw['capabilities'];
  if (Array.isArray(raw['data'])) return raw['data'];
  return [raw];
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) configurationError(`${label} must be positive`);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function configurationError(message: string): never {
  throw new ZeroAdapterError('contract_violation', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
