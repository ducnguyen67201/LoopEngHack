import { describe, expect, it } from 'vitest';

import type { PolicyPort, ZeroPort } from '../src/domain/ports.js';
import type { Observation } from '../src/domain/types.js';
import { RecruitingLoopCoordinator } from '../src/engine/coordinator.js';
import { EventFactory } from '../src/engine/event-factory.js';
import {
  FakeClock,
  FakeEventSink,
  FakeIdGenerator,
  FakePolicyPort,
  FakeRecruitingOpsPort,
  FakeZeroPort,
} from '../src/engine/fakes/index.js';
import { evaluateReplay } from '../src/engine/replay.js';
import { createInitialState, reduceState } from '../src/engine/reducer.js';
import { runFakeRecruitingEpisode } from '../src/engine/simulator.js';
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

  it('requires every independent success condition', async () => {
    const complete = await runFakeRecruitingEpisode();
    const incompleteStates = [
      { ...complete, metrics: { ...complete.metrics, manipulationAttempts: 0 } },
      { ...complete, metrics: { ...complete.metrics, detectionMisses: 0 } },
      { ...complete, metrics: { ...complete.metrics, pomeriumDenials: 0 } },
      { ...complete, metrics: { ...complete.metrics, verifiedCandidates: 0 } },
      { ...complete, metrics: { ...complete.metrics, testScreensScheduled: 0 } },
      { ...complete, metrics: { ...complete.metrics, falsePositives: 1 } },
      { ...complete, regressions: [] },
      { ...complete, events: complete.events.filter((event) => event.kind !== 'replay_result') },
    ];
    for (const state of incompleteStates) {
      expect(evaluateTermination(state).status).toBe('continue');
    }
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

  it('rejects duplicate event IDs and invalid event-factory state', () => {
    const ids = new FakeIdGenerator();
    const clock = new FakeClock();
    const factory = new EventFactory(clock, ids, new FakeEventSink());
    const draft = {
      schemaVersion: 1 as const,
      episodeId: 'episode-factory',
      turn: 0 as const,
      phase: 'sense' as const,
      kind: 'episode_started' as const,
      actor: 'arena' as const,
      summary: 'Factory test.',
      visualCue: 'arena-ready' as const,
      payload: {},
    };
    expect(() => factory.create(createInitialState(), draft)).toThrow(/before an episode/);

    let state = reduceState(createInitialState(), {
      type: 'start_episode',
      episodeId: 'another-episode',
    });
    expect(() => factory.create(state, draft)).toThrow(/does not match/);

    const event = {
      ...draft,
      id: 'event-duplicate',
      episodeId: 'another-episode',
      sequence: 1,
      occurredAt: createdAt,
    };
    state = reduceState(state, { type: 'append_event', event });
    expect(() =>
      reduceState(state, { type: 'append_event', event: { ...event, sequence: 2 } }),
    ).toThrow(/duplicate event id/);
  });

  it('refuses to run one coordinator instance twice', async () => {
    const ids = new FakeIdGenerator();
    const coordinator = new RecruitingLoopCoordinator({
      recruitingOps: new FakeRecruitingOpsPort({ ids }),
      zero: new FakeZeroPort({ ids }),
      policy: new FakePolicyPort({ ids }),
      clock: new FakeClock(),
      ids,
      events: new FakeEventSink(),
    });
    await coordinator.runToCompletion();
    await expect(coordinator.runToCompletion()).rejects.toThrow(/already owns an episode/);
  });

  it('fails closed when policy decisions do not match the expected identity', async () => {
    const makeCoordinator = (policy: PolicyPort) => {
      const ids = new FakeIdGenerator();
      return new RecruitingLoopCoordinator({
        recruitingOps: new FakeRecruitingOpsPort({ ids }),
        zero: new FakeZeroPort({ ids }),
        policy,
        clock: new FakeClock(),
        ids,
        events: new FakeEventSink(),
      });
    };

    const sourcerBase = new FakePolicyPort();
    const unexpectedSourcerAllow: PolicyPort = {
      async authorize(input, context) {
        const observation = await sourcerBase.authorize(input, context);
        if (input.actor !== 'outbound-sourcer' || observation.authorization === undefined) {
          return observation;
        }
        return {
          ...observation,
          authorization: { ...observation.authorization, decision: 'allow' },
        };
      },
    };
    await expect(makeCoordinator(unexpectedSourcerAllow).runToCompletion()).rejects.toThrow(
      /expected Pomerium to deny/,
    );

    const controllerBase = new FakePolicyPort();
    const unexpectedControllerDeny: PolicyPort = {
      async authorize(input, context) {
        const observation = await controllerBase.authorize(input, context);
        if (input.actor !== 'hiring-controller' || observation.authorization === undefined) {
          return observation;
        }
        return {
          ...observation,
          authorization: { ...observation.authorization, decision: 'deny' },
        };
      },
    };
    await expect(makeCoordinator(unexpectedControllerDeny).runToCompletion()).rejects.toThrow(
      /expected Pomerium to allow/,
    );
  });

  it('stops the episode when a recruiting side effect returns an error observation', async () => {
    const ids = new FakeIdGenerator();
    const coordinator = new RecruitingLoopCoordinator({
      recruitingOps: new FakeRecruitingOpsPort({
        ids,
        failures: { sendOutreach: 'upstream_failure' },
      }),
      zero: new FakeZeroPort({ ids }),
      policy: new FakePolicyPort({ ids }),
      clock: new FakeClock(),
      ids,
      events: new FakeEventSink(),
    });

    await expect(coordinator.runToCompletion()).rejects.toThrow(
      /test outreach failed closed \(upstream_failure\)/,
    );
  });

  it('rejects malformed Zero observations before learning from them', async () => {
    const runWithZero = async (transform: (observation: Observation) => Observation) => {
      const ids = new FakeIdGenerator();
      const base = new FakeZeroPort({ ids });
      const zero: ZeroPort = {
        async discover(input, context) {
          return transform(await base.discover(input, context));
        },
        invoke: (input, context) => base.invoke(input, context),
      };
      const coordinator = new RecruitingLoopCoordinator({
        recruitingOps: new FakeRecruitingOpsPort({ ids }),
        zero,
        policy: new FakePolicyPort({ ids }),
        clock: new FakeClock(),
        ids,
        events: new FakeEventSink(),
      });
      return coordinator.runToCompletion();
    };

    await expect(
      runWithZero((observation) => ({
        ...observation,
        facts: observation.facts.filter((fact) => fact.key !== 'capability_id'),
      })),
    ).rejects.toThrow(/missing string fact capability_id/);
    await expect(
      runWithZero((observation) => ({
        ...observation,
        facts: observation.facts.map((fact) =>
          fact.key === 'cost_usd' ? { ...fact, value: 'free' } : fact,
        ),
      })),
    ).rejects.toThrow(/missing number fact cost_usd/);
  });

  it('does not emit verification or regression success events after a Zero invocation error', async () => {
    const ids = new FakeIdGenerator();
    const events = new FakeEventSink();
    const coordinator = new RecruitingLoopCoordinator({
      recruitingOps: new FakeRecruitingOpsPort({ ids }),
      zero: new FakeZeroPort({ ids, failures: { invoke: 'upstream_failure' } }),
      policy: new FakePolicyPort({ ids }),
      clock: new FakeClock(),
      ids,
      events,
    });

    await expect(coordinator.runToCompletion()).rejects.toThrow(
      /Zero verification failed closed \(upstream_failure\)/,
    );
    expect(events.events.map((event) => event.kind)).not.toContain('verification_completed');
    expect(events.events.map((event) => event.kind)).not.toContain('regression_stored');
  });

  it('keeps private phase prerequisites fail-closed', () => {
    const ids = new FakeIdGenerator();
    const coordinator = new RecruitingLoopCoordinator({
      recruitingOps: new FakeRecruitingOpsPort({ ids }),
      zero: new FakeZeroPort({ ids }),
      policy: new FakePolicyPort({ ids }),
      clock: new FakeClock(),
      ids,
      events: new FakeEventSink(),
    }) as unknown as {
      episodeId(): string;
      requireTechnique(): string;
      requireDiagnosis(): unknown;
      requireVerificationNeed(): string;
    };
    expect(() => coordinator.episodeId()).toThrow(/has not started/);
    expect(() => coordinator.requireTechnique()).toThrow(/has not selected/);
    expect(() => coordinator.requireDiagnosis()).toThrow(/has not diagnosed/);
    expect(() => coordinator.requireVerificationNeed()).toThrow(/has not selected/);
  });
});

const createdAt = '2026-07-17T18:00:00.000Z';
