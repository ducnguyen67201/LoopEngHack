import { randomUUID } from 'node:crypto';

import { assertWithinBudget, formatMicroUsdAsUsd } from './budget.js';
import { buildZeroSearchQuery, normalizeCapabilities, normalizeCapability } from './discovery.js';
import { extractLinkedInUrl, hashArtifact, normalizePublicProfileFacts } from './evidence.js';
import { assertSafeTarget } from './policy.js';
import { selectCapability } from './selection.js';
import {
  ZeroAdapterError,
  type DiscoverVerificationInput,
  type InvokeVerificationInput,
  type VerificationNeed,
  type VerificationTarget,
  type ZeroCapability,
  type ZeroDiscoveryResult,
  type ZeroInvocationResult,
  type ZeroMode,
  type ZeroTransport,
} from './types.js';

export interface ZeroVerificationAdapterOptions {
  transport: ZeroTransport;
  mode: ZeroMode;
  transportLabel?: string;
  zeroCliVersion?: string;
  discoveryDetailLimit?: number;
}

export class ZeroVerificationAdapter {
  private readonly discoveries = new Map<string, ZeroDiscoveryResult>();
  private readonly transport: ZeroTransport;
  private readonly mode: ZeroMode;
  private readonly transportLabel: string;
  private readonly zeroCliVersion: string | undefined;
  private readonly discoveryDetailLimit: number;

  public constructor(options: ZeroVerificationAdapterOptions) {
    this.transport = options.transport;
    this.mode = options.mode;
    this.transportLabel = options.transportLabel ?? 'zero-cli';
    this.zeroCliVersion = options.zeroCliVersion;
    this.discoveryDetailLimit = options.discoveryDetailLimit ?? 8;
  }

  public async discover(input: DiscoverVerificationInput): Promise<ZeroDiscoveryResult> {
    // Public verification discovery is a fixed enum-to-query mapping and does
    // not need the claim target. The target is resolved and validated only at
    // invocation time. LinkedIn lookup discovery still uses subject fields.
    if (input.need === 'linkedin_profile_url' || input.need === 'linkedin_profile_enrichment') {
      assertSafeTarget(input);
    }
    const query = buildZeroSearchQuery(input.need, input.target);
    const raw = await this.transport.search(query, {
      limit: 10,
      maxCostUsd: formatMicroUsdAsUsd(input.budget.maxPerCallMicroUsd),
    });
    const searchCandidates = normalizeCapabilities(raw, 'search');
    const detailed = await this.loadDetails(searchCandidates);
    const byRef = new Map<string, ZeroCapability>();
    for (const candidate of [...searchCandidates, ...detailed]) {
      byRef.set(candidate.ref, {
        ...byRef.get(candidate.ref),
        ...candidate,
        source: candidate.source,
      });
    }

    const selection = selectCapability(input.need, [...byRef.values()], input.budget);
    const result: ZeroDiscoveryResult = {
      schemaVersion: 1,
      discoveryId: `zero-discovery-${randomUUID()}`,
      episodeId: input.episodeId,
      attemptId: input.attemptId,
      need: input.need,
      mode: this.mode,
      query,
      selected: selection.selected,
      alternatives: selection.alternatives,
      rejected: selection.rejected,
      provenance: {
        source: 'zero',
        transport: this.transportLabel,
        ...(this.zeroCliVersion ? { zeroCliVersion: this.zeroCliVersion } : {}),
        observedAt: input.now,
      },
    };

    this.discoveries.set(result.discoveryId, result);
    return result;
  }

  public async invoke(input: InvokeVerificationInput): Promise<ZeroInvocationResult> {
    assertSafeTarget(input);
    const discovery = this.discoveries.get(input.discoveryId);
    if (!discovery) {
      throw new ZeroAdapterError(
        'capability_not_discovered',
        'capability was not discovered by this adapter',
      );
    }
    const capability = [discovery.selected, ...discovery.alternatives].find(
      (candidate) => candidate?.ref === input.capabilityRef,
    );
    if (!capability) {
      throw new ZeroAdapterError(
        'capability_not_discovered',
        'capabilityRef must come from the current discovery result',
      );
    }

    assertWithinBudget(capability.declaredCostMicroUsd, input.budget);
    const requestBody = buildCapabilityRequest(input.need, input.target, capability);
    const response = await this.transport.fetch({
      capabilityRef: capability.ref,
      body: requestBody,
      maxPayUsd: formatMicroUsdAsUsd(
        Math.min(capability.declaredCostMicroUsd, input.budget.maxPerCallMicroUsd),
      ),
      timeoutSeconds: 60,
    });

    const artifactSource = response.bodyRaw ?? response.body ?? response.error ?? null;
    const artifact = hashArtifact(artifactSource);
    const linkedInUrl =
      input.need === 'linkedin_profile_url' ? extractLinkedInUrl(response.body) : null;
    const status = response.ok ? 'success' : response.status === null ? 'error' : 'warning';

    return {
      schemaVersion: 1,
      invocationId: `zero-invocation-${randomUUID()}`,
      episodeId: input.episodeId,
      attemptId: input.attemptId,
      discoveryId: input.discoveryId,
      capabilityRef: capability.ref,
      mode: this.mode,
      status,
      summary: response.ok
        ? `Zero returned ${summaryForNeed(input.need)} evidence.`
        : `Zero capability returned ${response.status ?? 'no'} status.`,
      facts: buildFacts(input.need, response.body, linkedInUrl),
      riskSignals: promptLikeOutput(response.body)
        ? [
            {
              key: 'prompt_like_output',
              detail: 'Capability output contains instruction-like text',
            },
          ]
        : [],
      uncertainties: response.ok ? [] : ['Capability output is unavailable or non-2xx'],
      artifact: {
        id: `artifact-${artifact.sha256.slice(0, 16)}`,
        sha256: artifact.sha256,
        mediaType: typeof artifactSource === 'string' ? 'text/plain' : 'application/json',
        byteLength: artifact.byteLength,
      },
      cost: {
        declaredMicroUsd: capability.declaredCostMicroUsd,
        maxPayMicroUsd: Math.min(capability.declaredCostMicroUsd, input.budget.maxPerCallMicroUsd),
      },
      provider: {
        name: capability.name,
        ...(capability.url ? { url: capability.url } : {}),
        runId: response.runId,
      },
      occurredAt: input.now,
    };
  }

  private async loadDetails(candidates: readonly ZeroCapability[]): Promise<ZeroCapability[]> {
    const details: ZeroCapability[] = [];
    for (const candidate of candidates.slice(0, this.discoveryDetailLimit)) {
      try {
        const raw = await this.transport.get(candidate.ref);
        const normalized = normalizeCapability(raw, 'detail');
        if (normalized) details.push({ ...candidate, ...normalized });
      } catch {
        details.push(candidate);
      }
    }
    return details;
  }
}

function buildCapabilityRequest(
  need: VerificationNeed,
  target: VerificationTarget,
  capability: ZeroCapability,
): Record<string, unknown> {
  switch (need) {
    case 'linkedin_profile_url':
      return {
        name: target.subject?.name,
        company: target.subject?.company,
        role: target.subject?.role,
        location: target.subject?.location,
        context: target.subject?.context,
      };
    case 'linkedin_profile_enrichment':
      return isDataLegionNoPiiCapability(capability)
        ? {
            social_url: target.subject?.linkedinUrl ?? target.url,
            include_fields: ['name', 'job_title', 'company', 'location', 'linkedin_url', 'skills'],
          }
        : { linkedin_url: target.subject?.linkedinUrl ?? target.url };
    case 'public_page_capture':
      return { url: target.url };
    case 'public_claim_lookup':
      return { url: target.url, claim: target.claim };
  }
}

function isDataLegionNoPiiCapability(capability: ZeroCapability): boolean {
  const identity = [capability.name, capability.slug, capability.url]
    .filter((value) => value !== undefined)
    .join(' ')
    .toLowerCase();
  return identity.includes('data legion') || identity.includes('data-legion');
}

function summaryForNeed(need: VerificationNeed): string {
  switch (need) {
    case 'linkedin_profile_url':
      return 'LinkedIn profile URL';
    case 'linkedin_profile_enrichment':
      return 'LinkedIn profile enrichment';
    case 'public_page_capture':
      return 'public page capture';
    case 'public_claim_lookup':
      return 'public claim lookup';
  }
}

function buildFacts(
  need: VerificationNeed,
  body: unknown,
  linkedInUrl: string | null,
): Array<{ key: string; value: string | string[]; source: string }> {
  const facts: Array<{ key: string; value: string | string[]; source: string }> = [];
  if (need === 'linkedin_profile_url' && linkedInUrl) {
    facts.push({ key: 'linkedin_profile_url', value: linkedInUrl, source: 'zero' });
  }
  if (need === 'linkedin_profile_enrichment') {
    facts.push(...normalizePublicProfileFacts(body));
  }
  if (body !== null && body !== undefined) {
    facts.push({ key: 'zero_response_present', value: 'true', source: 'zero' });
  }
  return facts;
}

function promptLikeOutput(value: unknown): boolean {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return /\b(ignore previous|system prompt|developer message|tool call)\b/i.test(raw);
}
