import { describe, expect, it } from 'vitest';

import { evaluateReplay } from '../src/engine/replay.js';
import { createInitialState, reduceState } from '../src/engine/reducer.js';
import { evaluateTermination } from '../src/engine/termination.js';

describe('termination and replay edge behavior', () => {
  it('covers budget, duplicate-side-effect, retry, and continue stops', () => {
    const budget = reduceState(createInitialState(), {
      type: 'increment_metric',
      metric: 'zeroSpendUsd',
      amount: 2,
    });
    expect(evaluateTermination(budget).status).toBe('failed');

    const duplicateSchedule = reduceState(createInitialState(), {
      type: 'increment_metric',
      metric: 'testScreensScheduled',
      amount: 2,
    });
    expect(evaluateTermination(duplicateSchedule).status).toBe('failed');

    let repeatedFailure = createInitialState();
    repeatedFailure = reduceState(repeatedFailure, { type: 'record_adapter_failure', key: 'zero' });
    repeatedFailure = reduceState(repeatedFailure, { type: 'record_adapter_failure', key: 'zero' });
    expect(evaluateTermination(repeatedFailure).status).toBe('failed');
    expect(evaluateTermination(createInitialState()).status).toBe('continue');
  });

  it('does not claim replay learning without a matching invariant', () => {
    expect(
      evaluateReplay([], {
        family: 'authority_spoof',
        mutationId: 'mutation-1',
        claimKind: 'candidate_asserted_authority',
      }),
    ).toEqual({
      blocked: false,
      regressionId: null,
      reason: 'no regression covers this attack family',
    });
    expect(
      evaluateReplay(
        [
          {
            id: 'regression-1',
            episodeId: 'episode-1',
            attackFamily: 'authority_spoof',
            failureInvariant: 'different_invariant',
            verificationNeed: 'public_claim_lookup',
            capabilityId: 'capability-1',
            hostileCaseIds: ['hostile-1'],
            legitimateCaseIds: ['control-1'],
            falsePositiveCount: 0,
            canonicalHash: 'a'.repeat(64),
            createdAt: createdAt,
          },
        ],
        {
          family: 'authority_spoof',
          mutationId: 'mutation-1',
          claimKind: 'candidate_asserted_urgency',
        },
      ).blocked,
    ).toBe(false);
  });

  it('covers reducer lifecycle guards and less common mutations', () => {
    expect(() => reduceState(createInitialState(), { type: 'complete_episode' })).toThrow(
      /has not started/,
    );
    expect(() => reduceState(createInitialState(), { type: 'fail_episode' })).toThrow(
      /has not started/,
    );
    expect(() =>
      reduceState(createInitialState(), { type: 'set_position', turn: 1, phase: 'plan' }),
    ).toThrow(/has not started/);

    let state = reduceState(createInitialState(), {
      type: 'start_episode',
      episodeId: 'episode-lifecycle',
    });
    state = reduceState(state, {
      type: 'set_pending_action',
      action: {
        id: 'attempt-1',
        episodeId: 'episode-lifecycle',
        actor: 'hiring-controller',
        tool: 'recruiting_schedule_screen',
        turn: 6,
        createdAt,
      },
    });
    expect(state.pendingAction?.id).toBe('attempt-1');
    state = reduceState(state, { type: 'set_pending_action', action: null });
    state = reduceState(state, { type: 'fail_episode' });
    expect(state.episode?.status).toBe('failed');
  });
});

const createdAt = '2026-07-17T18:00:00.000Z';
