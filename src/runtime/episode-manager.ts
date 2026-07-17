import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { AppConfig } from '../config.js';
import {
  PomeriumMcpClient,
  PomeriumPolicyPort,
  PomeriumRecruitingOpsPort,
} from '../adapters/pomerium/index.js';
import type { PolicyPort, RecruitingOpsPort } from '../domain/ports.js';
import type { VerificationEvidence } from '../domain/types.js';
import { RecruitingLoopCoordinator } from '../engine/coordinator.js';
import { FakePolicyPort, FakeRecruitingOpsPort, FakeZeroPort } from '../engine/fakes/index.js';
import type { LearningLoopResult, LoopCriteria, LoopReadiness } from '../loop/contracts.js';
import { FileLoopMemoryStore } from '../loop/memory-store.js';
import { LearningLoopRunner } from '../loop/runner.js';
import { PresentationEventHub } from '../server/presentation-events.js';
import { NamespacedIdGenerator, SystemClock } from './primitives.js';

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;

export interface EpisodeRunSnapshot {
  readonly id: string;
  readonly status: 'running' | 'complete' | 'failed';
  readonly createdAt: string;
  readonly readiness: LoopReadiness | null;
  readonly reason: string | null;
  readonly lastSequence: number;
  readonly eventCount: number;
}

interface EpisodeRunRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly hub: PresentationEventHub;
  readonly evidence: Map<string, VerificationEvidence>;
  status: EpisodeRunSnapshot['status'];
  readiness: LoopReadiness | null;
  reason: string | null;
  completion: Promise<LearningLoopResult>;
  protectedSchedules: Map<string, ProtectedSchedule>;
}

export interface ProtectedScheduleInput {
  readonly episodeId: string;
  readonly evidenceId: string;
  readonly candidateId: string;
  readonly roleId: string;
  readonly sandboxCalendarId: string;
}

export interface ProtectedSchedule extends ProtectedScheduleInput {
  readonly operationId: string;
}

export class EpisodeManager {
  private readonly runs = new Map<string, EpisodeRunRecord>();

  constructor(private readonly config: AppConfig) {}

  start(requestedId?: string, criteria: Partial<LoopCriteria> = {}): EpisodeRunSnapshot {
    if (this.config.DEMO_MODE === 'live') {
      throw new Error(
        'live mode requires real Zero and outbound adapters; use hybrid for Pomerium with the synthetic recruiting world',
      );
    }
    if ([...this.runs.values()].some((record) => record.status === 'running')) {
      throw new EpisodeConflictError('another learning loop is already running');
    }
    const id = requestedId ?? `loop-${randomUUID()}`;
    if (!RUN_ID.test(id)) throw new TypeError('episode id must be a bounded identifier');
    if (this.runs.has(id)) throw new EpisodeConflictError(`episode ${id} already exists`);

    const hub = new PresentationEventHub(id, this.config.DEMO_STEP_DELAY_MS);
    const evidence = new Map<string, VerificationEvidence>();
    const memoryPath = resolve(this.config.LOOP_MEMORY_DIRECTORY, `${id}.json`);
    const record: EpisodeRunRecord = {
      id,
      createdAt: new Date().toISOString(),
      hub,
      evidence,
      status: 'running',
      readiness: null,
      reason: null,
      completion: Promise.resolve(null as never),
      protectedSchedules: new Map(),
    };
    this.runs.set(id, record);

    const runner = new LearningLoopRunner({
      memoryStore: new FileLoopMemoryStore(memoryPath),
      eventSink: hub,
      runId: id,
      criteria: this.tightenCriteria(criteria),
      onEvidenceCreated: (createdEvidence) => evidence.set(createdEvidence.id, createdEvidence),
      onProgress: (readiness, state) => {
        record.readiness = readiness;
        const attack = state.events.find((event) => event.kind === 'attack_selected')?.payload
          .technique;
        if (
          attack === 'authority_spoof' ||
          attack === 'urgency_pressure' ||
          attack === 'portfolio_prompt_injection' ||
          attack === 'credential_mismatch'
        ) {
          hub.publishProgress(readiness, attack);
        }
      },
      createCoordinator: (input) => {
        const ids = new NamespacedIdGenerator(input.episodeId);
        const baseRecruitingOps = new FakeRecruitingOpsPort({ ids });
        let recruitingOps: RecruitingOpsPort = baseRecruitingOps;
        let policy: PolicyPort = new FakePolicyPort({ ids });
        if (this.config.DEMO_MODE === 'hybrid') {
          const sourcerClient = this.pomeriumClient('sourcer');
          const controllerClient = this.pomeriumClient('controller');
          policy = new PomeriumPolicyPort({
            runId: id,
            ids,
            clients: {
              'outbound-sourcer': sourcerClient,
              'hiring-controller': controllerClient,
            },
          });
          recruitingOps = new PomeriumRecruitingOpsPort({
            runId: id,
            ids,
            base: baseRecruitingOps,
            controllerClient,
          });
        }
        return new RecruitingLoopCoordinator(
          {
            recruitingOps,
            zero: new FakeZeroPort({ ids }),
            policy,
            clock: new SystemClock(),
            ids,
            events: input.events,
          },
          {
            memory: input.memory,
            onEvidenceCreated: input.onEvidenceCreated,
          },
        );
      },
    });

    record.completion = runner
      .run()
      .then((result) => {
        record.status = result.status;
        record.readiness = result.readiness;
        record.reason = result.reason;
        hub.publishTerminal(result);
        return result;
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : 'learning loop failed';
        record.status = 'failed';
        record.reason = reason;
        hub.publishFailure(reason);
        throw error;
      });
    void record.completion.catch(() => undefined);
    return this.snapshot(record);
  }

  get(id: string): EpisodeRunSnapshot | null {
    const record = this.runs.get(id);
    return record === undefined ? null : this.snapshot(record);
  }

  hub(id: string): PresentationEventHub | null {
    return this.runs.get(id)?.hub ?? null;
  }

  evidence(id: string, evidenceId: string): VerificationEvidence | null {
    return this.runs.get(id)?.evidence.get(evidenceId) ?? null;
  }

  executeProtectedSchedule(runId: string, input: ProtectedScheduleInput): ProtectedSchedule {
    const record = this.runs.get(runId);
    if (record === undefined) throw new Error(`unknown episode ${runId}`);
    const evidence = record.evidence.get(input.evidenceId);
    if (evidence === undefined) throw new Error('controller evidence was not registered');
    if (
      evidence.episodeId !== input.episodeId ||
      evidence.candidateId !== input.candidateId ||
      evidence.roleId !== input.roleId
    ) {
      throw new Error('protected schedule input does not match verified evidence');
    }
    if (input.sandboxCalendarId !== 'calendar-sandbox') {
      throw new Error('protected schedule target is not the sandbox calendar');
    }
    const existing = record.protectedSchedules.get(input.episodeId);
    if (existing !== undefined) {
      if (JSON.stringify(withoutOperation(existing)) !== JSON.stringify(input)) {
        throw new EpisodeConflictError(
          'only one protected sandbox schedule is allowed per episode',
        );
      }
      return existing;
    }
    const scheduled: ProtectedSchedule = {
      ...input,
      operationId: `pomerium-screen-${createHash('sha256')
        .update(`${runId}:${input.episodeId}`)
        .digest('hex')
        .slice(0, 24)}`,
    };
    record.protectedSchedules.set(input.episodeId, scheduled);
    return scheduled;
  }

  async wait(id: string): Promise<LearningLoopResult> {
    const record = this.runs.get(id);
    if (record === undefined) throw new Error(`unknown episode ${id}`);
    return record.completion;
  }

  private snapshot(record: EpisodeRunRecord): EpisodeRunSnapshot {
    const history = record.hub.history;
    return {
      id: record.id,
      status: record.status,
      createdAt: record.createdAt,
      readiness: record.readiness === null ? null : structuredClone(record.readiness),
      reason: record.reason,
      lastSequence: history.at(-1)?.sequence ?? 0,
      eventCount: history.length,
    };
  }

  private pomeriumClient(identity: 'sourcer' | 'controller'): PomeriumMcpClient {
    const routeUrl =
      identity === 'sourcer' ? this.config.SOURCER_MCP_URL : this.config.CONTROLLER_MCP_URL;
    const jwt =
      identity === 'sourcer'
        ? this.config.SOURCER_POMERIUM_JWT
        : this.config.CONTROLLER_POMERIUM_JWT;
    if (routeUrl === undefined || jwt === undefined) {
      throw new Error(`${identity} Pomerium route configuration is missing`);
    }
    return new PomeriumMcpClient({
      routeUrl,
      authorizationHeader: `Bearer Pomerium-${jwt}`,
      timeoutMs: 10_000,
    });
  }

  private tightenCriteria(requested: Partial<LoopCriteria>): LoopCriteria {
    const configured: LoopCriteria = {
      readinessThreshold: this.config.LOOP_READINESS_THRESHOLD,
      minimumHostileEvaluations: this.config.LOOP_MIN_HOSTILE_EVALUATIONS,
      minimumLegitimateControls: this.config.LOOP_MIN_LEGITIMATE_CONTROLS,
      maximumEpisodes: this.config.LOOP_MAX_EPISODES,
      stagnationEpisodes: this.config.LOOP_STAGNATION_EPISODES,
      maximumZeroSpendUsd: this.config.LOOP_MAX_ZERO_SPEND_USD,
    };
    return {
      readinessThreshold: Math.max(
        configured.readinessThreshold,
        requested.readinessThreshold ?? configured.readinessThreshold,
      ),
      minimumHostileEvaluations: Math.max(
        configured.minimumHostileEvaluations,
        requested.minimumHostileEvaluations ?? configured.minimumHostileEvaluations,
      ),
      minimumLegitimateControls: Math.max(
        configured.minimumLegitimateControls,
        requested.minimumLegitimateControls ?? configured.minimumLegitimateControls,
      ),
      maximumEpisodes: Math.min(
        configured.maximumEpisodes,
        requested.maximumEpisodes ?? configured.maximumEpisodes,
      ),
      stagnationEpisodes: Math.min(
        configured.stagnationEpisodes,
        requested.stagnationEpisodes ?? configured.stagnationEpisodes,
      ),
      maximumZeroSpendUsd: Math.min(
        configured.maximumZeroSpendUsd,
        requested.maximumZeroSpendUsd ?? configured.maximumZeroSpendUsd,
      ),
    };
  }
}

export class EpisodeConflictError extends Error {}

function withoutOperation(schedule: ProtectedSchedule): ProtectedScheduleInput {
  return {
    episodeId: schedule.episodeId,
    evidenceId: schedule.evidenceId,
    candidateId: schedule.candidateId,
    roleId: schedule.roleId,
    sandboxCalendarId: schedule.sandboxCalendarId,
  };
}
