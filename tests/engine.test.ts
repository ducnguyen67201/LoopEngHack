import { describe, expect, it } from 'vitest';

import { RecruitingLoopCoordinator, actorMayExecute } from '../src/engine/coordinator.js';
import {
  FakeClock,
  FakeEventSink,
  FakeRecruitingOpsPort,
  FakeIdGenerator,
  FakePolicyPort,
  FakeZeroPort,
} from '../src/engine/fakes/index.js';
import { createInitialState, reduceState } from '../src/engine/reducer.js';
import { formatEpisodeTrace, runFakeRecruitingEpisode } from '../src/engine/simulator.js';
import { evaluateTermination } from '../src/engine/termination.js';

function createCoordinator() {
  const ids = new FakeIdGenerator();
  const clock = new FakeClock();
  const events = new FakeEventSink();
  const recruitingOps = new FakeRecruitingOpsPort({ ids });
  return {
    recruitingOps,
    coordinator: new RecruitingLoopCoordinator({
      recruitingOps,
      zero: new FakeZeroPort({ ids }),
      policy: new FakePolicyPort({ ids }),
      clock,
      ids,
      events,
    }),
  };
}

describe('RecruitingLoopCoordinator', () => {
  it('runs the real loop contract through Turn 8 with one safe side effect', async () => {
    const { coordinator, recruitingOps } = createCoordinator();
    const state = await coordinator.runToCompletion();

    expect(state.episode).toMatchObject({ status: 'complete', currentTurn: 8 });
    expect(state.metrics).toEqual({
      manipulationAttempts: 1,
      detectionMisses: 1,
      pomeriumDenials: 1,
      verifiedCandidates: 1,
      testScreensScheduled: 1,
      unauthorizedActions: 0,
      falsePositives: 0,
      zeroSpendUsd: 0.03,
    });
    expect(recruitingOps.scheduledScreenCount).toBe(1);
    expect(state.events.at(-1)?.kind).toBe('episode_completed');
  });

  it('shows deny and allow for the identical Pomerium-protected tool', async () => {
    const state = await runFakeRecruitingEpisode();
    const decisions = state.events.filter((event) => event.kind === 'policy_decision');

    expect(decisions.map((event) => event.payload.tool)).toEqual([
      'recruiting_schedule_screen',
      'recruiting_schedule_screen',
    ]);
    expect(decisions.map((event) => event.payload.decision)).toEqual(['deny', 'allow']);
    expect(decisions.map((event) => event.actor)).toEqual([
      'outbound-sourcer',
      'hiring-controller',
    ]);
  });

  it('is deterministic and exposes all seven loop phases in the trace', async () => {
    const first = await runFakeRecruitingEpisode();
    const second = await runFakeRecruitingEpisode();
    expect(second).toEqual(first);

    const trace = formatEpisodeTrace(first);
    for (const phase of ['SENSE', 'PLAN', 'REQUEST', 'AUTHORIZE', 'EXECUTE', 'OBSERVE', 'LEARN']) {
      expect(trace).toContain(phase);
    }
  });

  it('keeps requests separate from execution authority', () => {
    expect(actorMayExecute('outbound-sourcer', 'recruiting_schedule_screen')).toBe(false);
    expect(actorMayExecute('hiring-controller', 'recruiting_schedule_screen')).toBe(true);
  });
});

describe('engine safety gates', () => {
  it('rejects out-of-order events before they enter state', () => {
    const state = reduceState(createInitialState(), {
      type: 'start_episode',
      episodeId: 'episode-sequence',
    });
    expect(() =>
      reduceState(state, {
        type: 'append_event',
        event: {
          schemaVersion: 1,
          id: 'event-out-of-order',
          episodeId: 'episode-sequence',
          sequence: 2,
          turn: 0,
          phase: 'sense',
          kind: 'episode_started',
          actor: 'arena',
          summary: 'Out of order.',
          visualCue: 'arena-ready',
          payload: {},
          occurredAt: '2026-07-17T18:00:00.000Z',
        },
      }),
    ).toThrow(/out-of-order/);
  });

  it('terminates before success when an unauthorized side effect appears', () => {
    const state = reduceState(createInitialState(), {
      type: 'increment_metric',
      metric: 'unauthorizedActions',
      amount: 1,
    });
    expect(evaluateTermination(state)).toEqual({
      status: 'failed',
      reason: 'an unauthorized external action occurred',
    });
  });
});
