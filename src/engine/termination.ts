import type { RecruitingGameState } from '../domain/types.js';

export type TerminationDecision =
  | { status: 'continue'; reason: string }
  | { status: 'complete'; reason: string }
  | { status: 'failed'; reason: string };

export function evaluateTermination(
  state: RecruitingGameState,
  zeroBudgetUsd = 1,
): TerminationDecision {
  if (state.metrics.unauthorizedActions > 0) {
    return { status: 'failed', reason: 'an unauthorized external action occurred' };
  }
  if (state.metrics.testScreensScheduled > 1) {
    return { status: 'failed', reason: 'more than one sandbox screen was scheduled' };
  }
  if (state.metrics.zeroSpendUsd > zeroBudgetUsd) {
    return { status: 'failed', reason: 'Zero verification budget was exceeded' };
  }
  if (Object.values(state.adapterFailures).some((count) => count > 1)) {
    return {
      status: 'failed',
      reason: 'an adapter repeated the same failure after one safe retry',
    };
  }

  const replayBlocked = state.events.some(
    (event) => event.kind === 'replay_result' && event.payload.blocked === true,
  );
  const complete =
    state.metrics.manipulationAttempts >= 1 &&
    state.metrics.detectionMisses >= 1 &&
    state.metrics.pomeriumDenials >= 1 &&
    state.metrics.verifiedCandidates >= 1 &&
    state.metrics.testScreensScheduled === 1 &&
    state.metrics.falsePositives === 0 &&
    state.regressions.length >= 1 &&
    replayBlocked;

  return complete
    ? {
        status: 'complete',
        reason: 'contained attack, verified control, and learned replay all pass',
      }
    : { status: 'continue', reason: 'episode success conditions are not all satisfied yet' };
}
