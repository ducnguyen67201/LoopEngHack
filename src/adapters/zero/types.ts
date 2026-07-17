export type VerificationNeed =
  | 'public_page_capture'
  | 'public_claim_lookup'
  | 'linkedin_profile_url'
  | 'linkedin_profile_enrichment';

export type ZeroMode = 'fake' | 'recorded' | 'live';

export interface CandidateSubject {
  name: string;
  company?: string;
  role?: string;
  location?: string;
  context?: string;
  linkedinUrl?: string;
}

export interface VerificationTarget {
  url?: string;
  claim?: string;
  subject?: CandidateSubject;
}

export interface ZeroBudget {
  maxPerCallMicroUsd: number;
  maxEpisodeMicroUsd: number;
  spentMicroUsd: number;
}

export interface DiscoverVerificationInput {
  episodeId: string;
  attemptId: string;
  need: VerificationNeed;
  target: VerificationTarget;
  allowedDomains: readonly string[];
  budget: ZeroBudget;
  now: string;
}

export interface InvokeVerificationInput {
  episodeId: string;
  attemptId: string;
  discoveryId: string;
  capabilityRef: string;
  need: VerificationNeed;
  target: VerificationTarget;
  allowedDomains: readonly string[];
  budget: ZeroBudget;
  now: string;
}

export interface ZeroSearchOptions {
  limit?: number;
  maxCostUsd?: string;
  freeOnly?: boolean;
  status?: 'healthy' | 'unknown' | 'degraded' | 'down';
  protocol?: 'x402' | 'mpp';
}

export interface ZeroFetchInput {
  capabilityRef: string;
  body: Record<string, unknown>;
  maxPayUsd: string;
  timeoutSeconds?: number;
}

export interface ZeroFetchResult {
  runId: string | null;
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  payment: unknown;
  body: unknown;
  bodyRaw: string | null;
  error?: string;
  upstreamError?: unknown;
}

export interface ZeroTransport {
  search(query: string, options: ZeroSearchOptions): Promise<unknown>;
  get(identifier: string): Promise<unknown>;
  fetch(input: ZeroFetchInput): Promise<ZeroFetchResult>;
}

export interface ZeroCapability {
  ref: string;
  uid?: string;
  slug?: string;
  name: string;
  description: string;
  url?: string;
  method?: string;
  protocol?: string;
  availabilityStatus?: string;
  declaredCostMicroUsd: number;
  source: 'search' | 'detail' | 'fixture';
  raw: unknown;
}

export interface ZeroDiscoveryResult {
  schemaVersion: 1;
  discoveryId: string;
  episodeId: string;
  attemptId: string;
  need: VerificationNeed;
  mode: ZeroMode;
  query: string;
  selected: ZeroCapability | null;
  alternatives: ZeroCapability[];
  rejected: Array<{ ref: string; reason: string }>;
  provenance: {
    source: 'zero';
    transport: string;
    zeroCliVersion?: string;
    observedAt: string;
  };
}

export interface ZeroInvocationResult {
  schemaVersion: 1;
  invocationId: string;
  episodeId: string;
  attemptId: string;
  discoveryId: string;
  capabilityRef: string;
  mode: ZeroMode;
  status: 'success' | 'warning' | 'error';
  summary: string;
  facts: Array<{ key: string; value: string | string[]; source: string }>;
  riskSignals: Array<{ key: string; detail: string }>;
  uncertainties: string[];
  artifact: {
    id: string;
    sha256: string;
    mediaType: 'application/json' | 'text/plain';
    byteLength: number;
  };
  cost: {
    declaredMicroUsd: number;
    maxPayMicroUsd: number;
  };
  provider: {
    name: string;
    url?: string;
    runId: string | null;
  };
  occurredAt: string;
}

export class ZeroAdapterError extends Error {
  public constructor(
    public readonly code:
      | 'invalid_target'
      | 'capability_unavailable'
      | 'budget_exceeded'
      | 'capability_not_discovered'
      | 'transport_failed'
      | 'contract_violation',
    message: string,
  ) {
    super(message);
    this.name = 'ZeroAdapterError';
  }
}
