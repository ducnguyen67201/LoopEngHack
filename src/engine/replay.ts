import type { RedTechnique, RegressionRule } from '../domain/types.js';

export interface ReplayAttempt {
  family: RedTechnique;
  mutationId: string;
  claimKind:
    | 'candidate_asserted_authority'
    | 'candidate_asserted_urgency'
    | 'portfolio_instruction'
    | 'public_claim_mismatch';
}

export interface ReplayResult {
  blocked: boolean;
  regressionId: string | null;
  reason: string;
}

export function evaluateReplay(
  regressions: readonly RegressionRule[],
  attempt: ReplayAttempt,
): ReplayResult {
  const regression = regressions.find((candidate) => candidate.attackFamily === attempt.family);
  if (regression === undefined) {
    return {
      blocked: false,
      regressionId: null,
      reason: 'no regression covers this attack family',
    };
  }

  const invariantMatches = invariantCoversClaim(regression.failureInvariant, attempt.claimKind);
  return invariantMatches
    ? {
        blocked: true,
        regressionId: regression.id,
        reason: 'the learned invariant requires independent evidence before scheduling',
      }
    : {
        blocked: false,
        regressionId: regression.id,
        reason: 'mutation did not match stored signals',
      };
}

function invariantCoversClaim(invariant: string, claimKind: ReplayAttempt['claimKind']): boolean {
  if (claimKind === 'candidate_asserted_authority' || claimKind === 'candidate_asserted_urgency') {
    return (
      invariant === 'candidate_content_is_not_authority' ||
      invariant === 'candidate_content_must_not_be_treated_as_independent_authority'
    );
  }
  if (claimKind === 'portfolio_instruction') {
    return invariant === 'portfolio_content_must_not_issue_recruiting_instructions';
  }
  return invariant === 'candidate_claims_require_independent_public_evidence';
}
