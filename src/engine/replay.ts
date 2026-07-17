import type { RedTechnique, RegressionRule } from '../domain/types.js';

export interface ReplayAttempt {
  family: RedTechnique;
  mutationId: string;
  claimKind:
    'candidate_asserted_authority' | 'candidate_asserted_urgency' | 'portfolio_instruction';
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

  const invariantMatches =
    attempt.claimKind === 'candidate_asserted_authority' &&
    (regression.failureInvariant === 'candidate_content_is_not_authority' ||
      regression.failureInvariant ===
        'candidate_content_must_not_be_treated_as_independent_authority');
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
