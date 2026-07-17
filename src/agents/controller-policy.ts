import type { VerificationEvidence } from '../domain/types.js';
import { computeCanonicalDigest } from './white-policy.js';

export const DEFAULT_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;

const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

export interface SchedulingEvidenceReferences {
  readonly episodeId: string;
  readonly candidateId: string;
  readonly roleId: string;
  readonly regressionId: string;
  readonly capabilityId?: string;
  readonly artifactHash?: string;
  readonly maxAgeMs?: number;
}

export type SchedulingEvidenceFailureReason =
  | 'missing_evidence'
  | 'episode_mismatch'
  | 'candidate_mismatch'
  | 'role_mismatch'
  | 'regression_mismatch'
  | 'capability_mismatch'
  | 'artifact_hash_mismatch'
  | 'missing_verification_artifact'
  | 'invalid_verification_artifact'
  | 'hostile_test_failed'
  | 'legitimate_control_failed'
  | 'false_positive_detected'
  | 'invalid_timestamp'
  | 'future_evidence'
  | 'stale_evidence'
  | 'digest_mismatch';

export type SchedulingEvidenceValidation =
  { readonly ok: true } | { readonly ok: false; readonly reason: SchedulingEvidenceFailureReason };

/**
 * Checks application evidence before a controller may request the scheduling side effect.
 * Pomerium identity authorization is intentionally a separate decision.
 */
export function validateSchedulingEvidence(
  evidence: VerificationEvidence | null | undefined,
  expected: SchedulingEvidenceReferences,
  now: Date | string,
): SchedulingEvidenceValidation {
  if (evidence === null || evidence === undefined) {
    return invalid('missing_evidence');
  }

  if (evidence.episodeId !== expected.episodeId) {
    return invalid('episode_mismatch');
  }

  if (evidence.candidateId !== expected.candidateId) {
    return invalid('candidate_mismatch');
  }

  if (evidence.roleId !== expected.roleId) {
    return invalid('role_mismatch');
  }

  if (evidence.regressionId !== expected.regressionId) {
    return invalid('regression_mismatch');
  }

  if (evidence.regressionId.trim().length === 0) {
    return invalid('regression_mismatch');
  }

  if (expected.capabilityId !== undefined && evidence.capabilityId !== expected.capabilityId) {
    return invalid('capability_mismatch');
  }

  if (expected.artifactHash !== undefined && evidence.artifactHash !== expected.artifactHash) {
    return invalid('artifact_hash_mismatch');
  }

  if (evidence.artifactIds.length === 0) {
    return invalid('missing_verification_artifact');
  }

  const uniqueArtifactIds = new Set(evidence.artifactIds);
  if (
    evidence.capabilityId.trim().length === 0 ||
    uniqueArtifactIds.size !== evidence.artifactIds.length ||
    evidence.artifactIds.some((artifactId) => artifactId.trim().length === 0) ||
    !SHA_256_PATTERN.test(evidence.artifactHash)
  ) {
    return invalid('invalid_verification_artifact');
  }

  if (!evidence.hostilePassed) {
    return invalid('hostile_test_failed');
  }

  if (!evidence.legitimateControlPassed) {
    return invalid('legitimate_control_failed');
  }

  if (evidence.falsePositiveCount !== 0) {
    return invalid('false_positive_detected');
  }

  const createdAtMs = Date.parse(evidence.createdAt);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) {
    return invalid('invalid_timestamp');
  }

  if (createdAtMs > nowMs) {
    return invalid('future_evidence');
  }

  const maximumAgeMs = expected.maxAgeMs ?? DEFAULT_EVIDENCE_MAX_AGE_MS;
  if (nowMs - createdAtMs > maximumAgeMs) {
    return invalid('stale_evidence');
  }

  const { digest, ...evidenceWithoutDigest } = evidence;
  if (computeCanonicalDigest(evidenceWithoutDigest) !== digest) {
    return invalid('digest_mismatch');
  }

  return { ok: true };
}

function invalid(reason: SchedulingEvidenceFailureReason): SchedulingEvidenceValidation {
  return { ok: false, reason };
}
