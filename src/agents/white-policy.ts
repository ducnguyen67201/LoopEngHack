import { createHash } from 'node:crypto';

import type {
  ArtifactReference,
  RedTechnique,
  RegressionRule,
  VerificationEvidence,
  VerificationNeed,
} from '../domain/types.js';

export type EvidenceGap =
  | 'independent_authority_evidence_missing'
  | 'public_claim_evidence_missing'
  | 'trusted_portfolio_evidence_missing';

export interface EvidenceGapInput {
  readonly technique: RedTechnique;
  readonly screenRecommended: boolean;
  readonly independentEvidencePresent: boolean;
  readonly candidateClaimWasTreatedAsAuthority: boolean;
  readonly schedulingAuthorizationDenied: boolean;
}

export interface EvidenceGapDiagnosis {
  readonly technique: RedTechnique;
  readonly gap: EvidenceGap;
  readonly failureInvariant: string;
  readonly requiresIndependentEvidence: true;
  readonly containedByAuthorization: boolean;
}

export interface CreateRegressionInput {
  readonly id: string;
  readonly episodeId: string;
  readonly diagnosis: EvidenceGapDiagnosis;
  readonly verificationNeed: VerificationNeed;
  readonly capabilityId: string;
  readonly hostileCaseIds: readonly string[];
  readonly legitimateCaseIds: readonly string[];
  readonly falsePositiveCount: number;
  readonly createdAt: string;
}

export interface CreateVerificationEvidenceInput {
  readonly id: string;
  readonly episodeId: string;
  readonly candidateId: string;
  readonly roleId: string;
  readonly regressionId: string;
  readonly capabilityId: string;
  readonly artifacts: readonly ArtifactReference[];
  readonly hostilePassed: boolean;
  readonly legitimateControlPassed: boolean;
  readonly falsePositiveCount: 0;
  readonly createdAt: string;
}

const FAILURE_INVARIANTS: Readonly<Record<EvidenceGap, string>> = Object.freeze({
  independent_authority_evidence_missing:
    'candidate_content_must_not_be_treated_as_independent_authority',
  public_claim_evidence_missing: 'candidate_claims_require_independent_public_evidence',
  trusted_portfolio_evidence_missing: 'portfolio_content_must_not_issue_recruiting_instructions',
});

const VERIFICATION_NEEDS: Readonly<Record<EvidenceGap, VerificationNeed>> = Object.freeze({
  independent_authority_evidence_missing: 'public_claim_lookup',
  public_claim_evidence_missing: 'public_claim_lookup',
  trusted_portfolio_evidence_missing: 'public_page_capture',
});

/** Diagnoses the authority/evidence boundary without consuming raw candidate prose. */
export function diagnoseEvidenceGap(input: EvidenceGapInput): EvidenceGapDiagnosis {
  const gap = classifyEvidenceGap(input);

  return {
    technique: input.technique,
    gap,
    failureInvariant: FAILURE_INVARIANTS[gap],
    requiresIndependentEvidence: true,
    containedByAuthorization: input.schedulingAuthorizationDenied,
  };
}

export function selectVerificationNeed(diagnosis: EvidenceGapDiagnosis): VerificationNeed {
  return VERIFICATION_NEEDS[diagnosis.gap];
}

/** Hashes JSON-like data after recursively sorting object keys. */
export function computeCanonicalDigest(value: unknown): string {
  const canonicalValue = canonicalize(value, new WeakSet<object>());
  return createHash('sha256').update(canonicalValue, 'utf8').digest('hex');
}

export function createRegression(input: CreateRegressionInput): RegressionRule {
  if (input.hostileCaseIds.length === 0 || input.legitimateCaseIds.length === 0) {
    throw new TypeError('Regression rules require hostile and legitimate control cases');
  }

  const regressionWithoutDigest = {
    id: input.id,
    episodeId: input.episodeId,
    attackFamily: input.diagnosis.technique,
    failureInvariant: input.diagnosis.failureInvariant,
    verificationNeed: input.verificationNeed,
    capabilityId: input.capabilityId,
    hostileCaseIds: [...input.hostileCaseIds].sort(compareText),
    legitimateCaseIds: [...input.legitimateCaseIds].sort(compareText),
    falsePositiveCount: input.falsePositiveCount,
    createdAt: input.createdAt,
  };

  return {
    ...regressionWithoutDigest,
    canonicalHash: computeCanonicalDigest(regressionWithoutDigest),
  };
}

export function createVerificationEvidence(
  input: CreateVerificationEvidenceInput,
): VerificationEvidence {
  if (input.artifacts.length === 0) {
    throw new TypeError('Verification evidence requires at least one artifact');
  }

  const artifacts = [...input.artifacts].sort((left, right) => compareText(left.id, right.id));
  const evidenceWithoutDigest = {
    id: input.id,
    episodeId: input.episodeId,
    candidateId: input.candidateId,
    roleId: input.roleId,
    regressionId: input.regressionId,
    capabilityId: input.capabilityId,
    artifactIds: artifacts.map((artifact) => artifact.id),
    artifactHash: computeCanonicalDigest(artifacts),
    hostilePassed: input.hostilePassed,
    legitimateControlPassed: input.legitimateControlPassed,
    falsePositiveCount: input.falsePositiveCount,
    createdAt: input.createdAt,
  };

  return {
    ...evidenceWithoutDigest,
    digest: computeCanonicalDigest(evidenceWithoutDigest),
  };
}

function classifyEvidenceGap(input: EvidenceGapInput): EvidenceGap {
  if (input.technique === 'portfolio_prompt_injection') {
    return 'trusted_portfolio_evidence_missing';
  }

  if (input.technique === 'credential_mismatch') {
    return 'public_claim_evidence_missing';
  }

  if (
    input.candidateClaimWasTreatedAsAuthority ||
    (input.screenRecommended && !input.independentEvidencePresent)
  ) {
    return 'independent_authority_evidence_missing';
  }

  return 'public_claim_evidence_missing';
}

function canonicalize(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical digests require finite numbers');
    }

    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }

  if (typeof value !== 'object') {
    throw new TypeError(`Canonical digests do not support ${typeof value} values`);
  }

  if (ancestors.has(value)) {
    throw new TypeError('Canonical digests do not support cyclic values');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalize(item, ancestors)).join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical digests require plain objects');
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => compareText(leftKey, rightKey))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue, ancestors)}`);

    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}
