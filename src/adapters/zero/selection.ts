import { assertWithinBudget } from './budget.js';
import { capabilityText, isPotentialCapability } from './discovery.js';
import type { VerificationNeed, ZeroBudget, ZeroCapability } from './types.js';

export interface SelectionResult {
  selected: ZeroCapability | null;
  alternatives: ZeroCapability[];
  rejected: Array<{ ref: string; reason: string }>;
}

export function selectCapability(
  need: VerificationNeed,
  candidates: readonly ZeroCapability[],
  budget: ZeroBudget,
): SelectionResult {
  const rejected: Array<{ ref: string; reason: string }> = [];
  const accepted: ZeroCapability[] = [];

  for (const candidate of candidates) {
    if (!isPotentialCapability(need, candidate)) {
      rejected.push({ ref: candidate.ref, reason: 'capability does not match local allowlist' });
      continue;
    }
    if (candidate.availabilityStatus === 'down') {
      rejected.push({ ref: candidate.ref, reason: 'capability is marked down' });
      continue;
    }
    try {
      assertWithinBudget(candidate.declaredCostMicroUsd, budget);
    } catch {
      rejected.push({ ref: candidate.ref, reason: 'capability exceeds budget' });
      continue;
    }
    accepted.push(candidate);
  }

  const ranked = [...accepted].sort((left, right) => {
    const scoreDelta = scoreCapability(need, right) - scoreCapability(need, left);
    if (scoreDelta !== 0) return scoreDelta;

    const costDelta = left.declaredCostMicroUsd - right.declaredCostMicroUsd;
    if (costDelta !== 0) return costDelta;

    return left.ref.localeCompare(right.ref);
  });

  return {
    selected: ranked[0] ?? null,
    alternatives: ranked.slice(1, 4),
    rejected,
  };
}

function scoreCapability(need: VerificationNeed, capability: ZeroCapability): number {
  const text = capabilityText(capability).toLowerCase();
  let score = 0;
  if (text.includes('provenance')) score += 4;
  if (text.includes('public')) score += 2;
  if (capability.availabilityStatus === 'healthy') score += 2;
  if (capability.protocol === 'mpp' || capability.protocol === 'x402') score += 1;

  if (need === 'linkedin_profile_url' && text.includes('find profile url')) score += 8;
  if (
    need === 'linkedin_profile_enrichment' &&
    (text.includes('person profile enrichment') || text.includes('linkedin profile enrichment'))
  ) {
    score += 8;
  }
  if (need === 'public_page_capture' && text.includes('screenshot')) score += 5;
  if (need === 'public_claim_lookup' && text.includes('search')) score += 5;
  return score;
}
