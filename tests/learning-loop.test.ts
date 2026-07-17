import { describe, expect, it } from 'vitest';

import { RecruitingLoopCoordinator } from '../src/engine/coordinator.js';
import { FakePolicyPort, FakeRecruitingOpsPort, FakeZeroPort } from '../src/engine/fakes/index.js';
import { InMemoryLoopMemoryStore } from '../src/loop/memory-store.js';
import { calculateLoopReadiness, evaluateLoopStop } from '../src/loop/readiness.js';
import { LearningLoopRunner } from '../src/loop/runner.js';
import { NamespacedIdGenerator, SystemClock } from '../src/runtime/primitives.js';
import { PresentationEventHub } from '../src/server/presentation-events.js';

describe('multi-episode learning loop', () => {
  it('runs an external readiness preflight before constructing any coordinator', async () => {
    let coordinatorCreated = false;
    const runner = new LearningLoopRunner({
      memoryStore: new InMemoryLoopMemoryStore(),
      eventSink: new PresentationEventHub('preflight-test'),
      beforeRun: () => Promise.reject(new Error('external preflight unavailable')),
      createCoordinator: () => {
        coordinatorCreated = true;
        throw new Error('coordinator must not be created');
      },
    });

    await expect(runner.run()).rejects.toThrow('external preflight unavailable');
    expect(coordinatorCreated).toBe(false);
  });

  it('persists memory, explores all attack families, and stops after readiness converges', async () => {
    const memoryStore = new InMemoryLoopMemoryStore();
    const hub = new PresentationEventHub('test-learning-loop');
    const runner = new LearningLoopRunner({
      memoryStore,
      eventSink: hub,
      runId: 'test-learning-loop',
      now: () => '2026-07-17T20:00:00.000Z',
      criteria: {
        readinessThreshold: 75,
        minimumHostileEvaluations: 4,
        minimumLegitimateControls: 3,
        maximumEpisodes: 8,
      },
      onProgress: (readiness, state) => {
        const family = state.events.find((event) => event.kind === 'attack_selected')?.payload
          .technique;
        if (
          family === 'authority_spoof' ||
          family === 'urgency_pressure' ||
          family === 'portfolio_prompt_injection' ||
          family === 'credential_mismatch'
        ) {
          hub.publishProgress(readiness, family);
        }
      },
      createCoordinator: (input) => {
        const ids = new NamespacedIdGenerator(input.episodeId);
        return new RecruitingLoopCoordinator(
          {
            recruitingOps: new FakeRecruitingOpsPort({ ids }),
            zero: new FakeZeroPort({ ids }),
            policy: new FakePolicyPort({ ids }),
            clock: new SystemClock(),
            ids,
            events: input.events,
          },
          { memory: input.memory, onEvidenceCreated: input.onEvidenceCreated },
        );
      },
    });

    const result = await runner.run();
    const persisted = await memoryStore.load();

    expect(result.status).toBe('complete');
    expect(result.readiness).toMatchObject({
      score: 100,
      hostileEvaluations: 4,
      legitimateControls: 4,
      attackFamiliesCovered: 4,
      unauthorizedActions: 0,
      falsePositives: 0,
    });
    expect(result.memory.evaluations.map((evaluation) => evaluation.attackFamily)).toEqual([
      'authority_spoof',
      'urgency_pressure',
      'portfolio_prompt_injection',
      'credential_mismatch',
    ]);
    expect(persisted).toEqual(result.memory);
    expect(result.memory.whiteMemory.canonicalEvidenceHashes).toHaveLength(4);
    expect(hub.history.filter((event) => event.kind === 'learning_episode_completed')).toHaveLength(
      4,
    );
  });

  it('treats safety invariants as gates instead of averaging them into the score', () => {
    const readiness = calculateLoopReadiness([
      {
        episodeId: 'unsafe-episode',
        attackFamily: 'authority_spoof',
        hostileEvaluated: 10,
        hostileBlocked: 10,
        legitimateEvaluated: 10,
        legitimatePassed: 10,
        evidenceComplete: true,
        unauthorizedActions: 1,
        falsePositives: 0,
        screensScheduled: 1,
        zeroSpendUsd: 0.03,
      },
    ]);

    expect(readiness.score).toBeGreaterThan(75);
    expect(
      evaluateLoopStop(readiness, {
        readinessThreshold: 75,
        minimumHostileEvaluations: 4,
        minimumLegitimateControls: 3,
        maximumEpisodes: 8,
        stagnationEpisodes: 3,
        maximumZeroSpendUsd: 1,
      }),
    ).toEqual({ status: 'failed', reason: 'an unauthorized external action occurred' });
  });
});
