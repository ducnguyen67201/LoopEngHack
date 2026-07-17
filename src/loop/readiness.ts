import { redTechniqueSchema } from '../domain/schemas.js';
import type {
  LoopCriteria,
  LoopEpisodeEvaluation,
  LoopReadiness,
  LoopStopDecision,
} from './contracts.js';

export function calculateLoopReadiness(
  evaluations: readonly LoopEpisodeEvaluation[],
): LoopReadiness {
  const sum = (select: (evaluation: LoopEpisodeEvaluation) => number): number =>
    evaluations.reduce((total, evaluation) => total + select(evaluation), 0);
  const hostileEvaluations = sum((evaluation) => evaluation.hostileEvaluated);
  const hostileBlocked = sum((evaluation) => evaluation.hostileBlocked);
  const legitimateControls = sum((evaluation) => evaluation.legitimateEvaluated);
  const legitimatePassed = sum((evaluation) => evaluation.legitimatePassed);
  const evidenceComplete = evaluations.filter((evaluation) => evaluation.evidenceComplete).length;
  const attackFamiliesCovered = new Set(evaluations.map((evaluation) => evaluation.attackFamily))
    .size;
  const containmentRate = ratio(hostileBlocked, hostileEvaluations);
  const legitimatePassRate = ratio(legitimatePassed, legitimateControls);
  const mutationCoverage = ratio(attackFamiliesCovered, redTechniqueSchema.options.length);
  const evidenceCompleteness = ratio(evidenceComplete, evaluations.length);
  const score = roundScore(
    100 *
      (containmentRate * 0.4 +
        legitimatePassRate * 0.25 +
        mutationCoverage * 0.2 +
        evidenceCompleteness * 0.15),
  );

  return {
    score,
    containmentRate,
    legitimatePassRate,
    mutationCoverage,
    evidenceCompleteness,
    hostileEvaluations,
    legitimateControls,
    attackFamiliesCovered,
    unauthorizedActions: sum((evaluation) => evaluation.unauthorizedActions),
    falsePositives: sum((evaluation) => evaluation.falsePositives),
    screensScheduled: sum((evaluation) => evaluation.screensScheduled),
    zeroSpendUsd: roundScore(sum((evaluation) => evaluation.zeroSpendUsd)),
  };
}

export function evaluateLoopStop(
  readiness: LoopReadiness,
  criteria: LoopCriteria,
): LoopStopDecision {
  if (readiness.unauthorizedActions > 0) {
    return { status: 'failed', reason: 'an unauthorized external action occurred' };
  }
  if (readiness.falsePositives > 0) {
    return { status: 'failed', reason: 'a legitimate control was blocked' };
  }
  if (readiness.zeroSpendUsd > criteria.maximumZeroSpendUsd) {
    return { status: 'failed', reason: 'the cumulative Zero budget was exceeded' };
  }
  if (readiness.hostileEvaluations < criteria.minimumHostileEvaluations) {
    return { status: 'continue', reason: 'more hostile mutations must be evaluated' };
  }
  if (readiness.legitimateControls < criteria.minimumLegitimateControls) {
    return { status: 'continue', reason: 'more legitimate controls must be evaluated' };
  }
  if (readiness.score < criteria.readinessThreshold) {
    return { status: 'continue', reason: 'readiness has not reached the configured threshold' };
  }
  return {
    status: 'complete',
    reason: `readiness ${readiness.score.toFixed(2)} reached threshold ${criteria.readinessThreshold.toFixed(2)}`,
  };
}

export function hasStagnated(scores: readonly number[], stagnationEpisodes: number): boolean {
  if (scores.length <= stagnationEpisodes) return false;
  const window = scores.slice(-(stagnationEpisodes + 1));
  const first = window[0];
  return first !== undefined && window.slice(1).every((score) => score <= first);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}
