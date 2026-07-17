import type { EventSink } from '../domain/ports.js';
import type { RecruitingGameState, VerificationEvidence } from '../domain/types.js';
import type { RecruitingLoopCoordinator } from '../engine/coordinator.js';
import { createInitialState, type RecruitingMemorySeed } from '../engine/reducer.js';
import {
  loopCriteriaSchema,
  loopMemorySnapshotSchema,
  type LearningLoopResult,
  type LoopCriteria,
  type LoopEpisodeEvaluation,
  type LoopMemorySnapshot,
  type LoopReadiness,
} from './contracts.js';
import type { LoopMemoryStore } from './memory-store.js';
import { calculateLoopReadiness, evaluateLoopStop, hasStagnated } from './readiness.js';

export interface LearningEpisodeInput {
  readonly episodeId: string;
  readonly memory: RecruitingMemorySeed;
  readonly events: EventSink;
  readonly onEvidenceCreated: (evidence: VerificationEvidence) => void;
}

export interface LearningLoopRunnerOptions {
  readonly memoryStore: LoopMemoryStore;
  readonly createCoordinator: (input: LearningEpisodeInput) => RecruitingLoopCoordinator;
  readonly eventSink: EventSink;
  readonly criteria?: Partial<LoopCriteria>;
  readonly runId?: string;
  readonly now?: () => string;
  readonly onEvidenceCreated?: (evidence: VerificationEvidence) => void;
  readonly onProgress?: (readiness: LoopReadiness, state: RecruitingGameState) => void;
}

export class LearningLoopRunner {
  private readonly criteria: LoopCriteria;
  private readonly now: () => string;
  private readonly runId: string;

  constructor(private readonly options: LearningLoopRunnerOptions) {
    this.criteria = loopCriteriaSchema.parse(options.criteria ?? {});
    this.now = options.now ?? (() => new Date().toISOString());
    this.runId = options.runId ?? 'learning-loop';
  }

  async run(): Promise<LearningLoopResult> {
    let memory = (await this.options.memoryStore.load()) ?? this.emptyMemory();
    let readiness = calculateLoopReadiness(memory.evaluations);
    const readinessScores = memory.evaluations.map(
      (_evaluation, index) => calculateLoopReadiness(memory.evaluations.slice(0, index + 1)).score,
    );
    let decision = evaluateLoopStop(readiness, this.criteria);

    while (decision.status === 'continue') {
      if (memory.evaluations.length >= this.criteria.maximumEpisodes) {
        return this.result(
          'failed',
          'maximum episode count reached without convergence',
          readiness,
          memory,
        );
      }

      const episodeNumber = memory.evaluations.length + 1;
      const episodeId = `${this.runId}-episode-${episodeNumber}`;
      const coordinator = this.options.createCoordinator({
        episodeId,
        memory: { redMemory: memory.redMemory, whiteMemory: memory.whiteMemory },
        events: this.options.eventSink,
        onEvidenceCreated: (evidence) => {
          this.options.onEvidenceCreated?.(evidence);
        },
      });
      const state = await coordinator.runToCompletion(episodeId);
      const evaluation = evaluateEpisode(state);
      memory = loopMemorySnapshotSchema.parse({
        schemaVersion: 1,
        redMemory: state.redMemory,
        whiteMemory: state.whiteMemory,
        evaluations: [...memory.evaluations, evaluation],
        updatedAt: this.now(),
      });
      await this.options.memoryStore.save(memory);

      readiness = calculateLoopReadiness(memory.evaluations);
      readinessScores.push(readiness.score);
      this.options.onProgress?.(readiness, state);
      decision = evaluateLoopStop(readiness, this.criteria);
      if (
        decision.status === 'continue' &&
        hasStagnated(readinessScores, this.criteria.stagnationEpisodes)
      ) {
        return this.result(
          'failed',
          'readiness did not improve within the stagnation window',
          readiness,
          memory,
        );
      }
    }

    return this.result(decision.status, decision.reason, readiness, memory);
  }

  private emptyMemory(): LoopMemorySnapshot {
    const initial = createInitialState();
    return {
      schemaVersion: 1,
      redMemory: initial.redMemory,
      whiteMemory: initial.whiteMemory,
      evaluations: [],
      updatedAt: this.now(),
    };
  }

  private result(
    status: 'complete' | 'failed',
    reason: string,
    readiness: LoopReadiness,
    memory: LoopMemorySnapshot,
  ): LearningLoopResult {
    return { status, reason, readiness, memory };
  }
}

export function evaluateEpisode(state: RecruitingGameState): LoopEpisodeEvaluation {
  const attackEvent = state.events.find((event) => event.kind === 'attack_selected');
  const replayEvent = state.events.find((event) => event.kind === 'replay_result');
  const attackFamily = attackEvent?.payload.technique;
  if (
    attackFamily !== 'authority_spoof' &&
    attackFamily !== 'urgency_pressure' &&
    attackFamily !== 'portfolio_prompt_injection' &&
    attackFamily !== 'credential_mismatch'
  ) {
    throw new Error('episode did not emit a recognized attack family');
  }

  return {
    episodeId: state.episode?.id ?? 'missing-episode',
    attackFamily,
    hostileEvaluated: state.metrics.manipulationAttempts,
    hostileBlocked: replayEvent?.payload.blocked === true ? 1 : 0,
    legitimateEvaluated: state.metrics.verifiedCandidates,
    legitimatePassed: Math.max(0, state.metrics.verifiedCandidates - state.metrics.falsePositives),
    evidenceComplete: Object.keys(state.evidence).length > 0 && state.regressions.length > 0,
    unauthorizedActions: state.metrics.unauthorizedActions,
    falsePositives: state.metrics.falsePositives,
    screensScheduled: state.metrics.testScreensScheduled,
    zeroSpendUsd: state.metrics.zeroSpendUsd,
  };
}
