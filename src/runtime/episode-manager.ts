import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { AppConfig } from '../config.js';
import { ElevenLabsLoopClosureClient } from '../adapters/elevenlabs/loop-closure-client.js';
import {
  createGoogleCalendarSandboxPort,
  type CalendarSchedulePort,
} from '../adapters/calendar/index.js';
import { HttpOutboundRecruitingOpsPort } from '../adapters/outbound/index.js';
import {
  PomeriumMcpClient,
  PomeriumPolicyPort,
  PomeriumRecruitingOpsPort,
} from '../adapters/pomerium/index.js';
import { createLiveZeroPort, type LiveZeroPortRuntime } from '../adapters/zero/index.js';
import type { PolicyPort, RecruitingOpsPort } from '../domain/ports.js';
import type { VerificationEvidence } from '../domain/types.js';
import { RecruitingLoopCoordinator } from '../engine/coordinator.js';
import { FakePolicyPort, FakeRecruitingOpsPort, FakeZeroPort } from '../engine/fakes/index.js';
import type { LearningLoopResult, LoopCriteria, LoopReadiness } from '../loop/contracts.js';
import type { LoopClosureContext, LoopClosurePort, SpokenLoopClosure } from '../loop/closure.js';
import { FileLoopMemoryStore } from '../loop/memory-store.js';
import { LearningLoopRunner } from '../loop/runner.js';
import { PresentationEventHub } from '../server/presentation-events.js';
import { NamespacedIdGenerator, SystemClock } from './primitives.js';
import { createSyntheticClaimTargetResolver } from './zero-claim-targets.js';

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;

export interface EpisodeRunSnapshot {
  readonly id: string;
  readonly status: 'running' | 'awaiting_human' | 'complete' | 'failed';
  readonly createdAt: string;
  readonly readiness: LoopReadiness | null;
  readonly reason: string | null;
  readonly lastSequence: number;
  readonly eventCount: number;
  readonly closure: LoopClosureSnapshot | null;
}

export interface LoopClosureSnapshot {
  readonly status: 'awaiting_response' | 'received' | 'failed';
  readonly conversationId: string;
  readonly responseReceived: boolean;
  readonly closedAt: string | null;
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
  terminalResult: LearningLoopResult | null;
  closure: LoopClosureRecord | null;
}

interface LoopClosureRecord {
  readonly status: LoopClosureSnapshot['status'];
  readonly conversationId: string;
  readonly callSid: string | null;
  readonly responseDigest: string | null;
  readonly closedAt: string | null;
}

export interface EpisodeManagerOptions {
  readonly closurePort?: LoopClosurePort | null;
  readonly calendar?: CalendarSchedulePort;
  readonly liveZeroRuntime?: LiveZeroPortRuntime;
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
  readonly eventId?: string;
  readonly idempotentReplay: boolean;
}

export class EpisodeManager {
  private readonly runs = new Map<string, EpisodeRunRecord>();
  private readonly closurePort: LoopClosurePort | null;
  private readonly calendar: CalendarSchedulePort | null;

  constructor(
    private readonly config: AppConfig,
    private readonly options: EpisodeManagerOptions = {},
  ) {
    this.closurePort =
      this.options.closurePort === undefined
        ? createLoopClosurePort(config)
        : this.options.closurePort;
    this.calendar = this.options.calendar ?? this.calendarPort();
  }

  start(
    requestedId?: string,
    criteria: Partial<LoopCriteria> = {},
    closureToNumber?: string,
    phoneFirst = false,
  ): EpisodeRunSnapshot {
    if (
      [...this.runs.values()].some(
        (record) => record.status === 'running' || record.status === 'awaiting_human',
      )
    ) {
      throw new EpisodeConflictError('another learning loop is already running');
    }
    const id = requestedId ?? `loop-${randomUUID()}`;
    if (!RUN_ID.test(id)) throw new TypeError('episode id must be a bounded identifier');
    if (this.runs.has(id)) throw new EpisodeConflictError(`episode ${id} already exists`);

    const hub = new PresentationEventHub(id, this.config.DEMO_STEP_DELAY_MS);
    const evidence = new Map<string, VerificationEvidence>();
    const memoryPath = resolve(this.config.LOOP_MEMORY_DIRECTORY, `${id}.json`);
    const liveZero = this.liveZeroRuntime();
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
      terminalResult: null,
      closure: null,
    };
    this.runs.set(id, record);

    const runner = new LearningLoopRunner({
      memoryStore: new FileLoopMemoryStore(memoryPath),
      eventSink: hub,
      runId: id,
      criteria: this.tightenCriteria(criteria),
      ...(liveZero === null
        ? {}
        : {
            beforeRun: async () => {
              const probe = await liveZero.probe();
              if (probe.status !== 'ready_for_discovery') {
                throw new Error('live Zero preflight failed closed before outbound side effects');
              }
            },
          }),
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
        const baseRecruitingOps = this.recruitingOps(ids);
        let recruitingOps: RecruitingOpsPort = baseRecruitingOps;
        let policy: PolicyPort = new FakePolicyPort({ ids });
        if (this.config.DEMO_MODE === 'hybrid' || this.config.DEMO_MODE === 'live') {
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
        const zero = liveZero?.port ?? new FakeZeroPort({ ids });
        return new RecruitingLoopCoordinator(
          {
            recruitingOps,
            zero,
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

    if (phoneFirst && this.closurePort !== null) {
      const closureContext = phoneFirstClosureContext(id, closureToNumber);
      record.completion = this.closurePort
        .requestClosure(closureContext)
        .then(async (receipt) => {
          record.closure = {
            status: 'awaiting_response',
            conversationId: receipt.conversationId,
            callSid: receipt.callSid ?? null,
            responseDigest: null,
            closedAt: null,
          };
          record.status = 'awaiting_human';
          hub.publishClosureRequested(receipt.conversationId, false);
          if (this.closurePort?.waitForSpokenResponse === undefined) {
            throw new Error('phone-first demo requires authenticated transcript polling');
          }
          const spoken = await this.closurePort.waitForSpokenResponse(receipt, closureContext);
          if (spoken.loopId !== id || spoken.conversationId !== receipt.conversationId) {
            throw new LoopClosureConflictError('the phone transcript does not match the live call');
          }
          record.closure = {
            ...record.closure,
            status: 'received',
            responseDigest: createHash('sha256').update(spoken.response).digest('hex'),
            closedAt: new Date().toISOString(),
          };
          record.status = 'running';
          hub.publishManualVoiceAttack(spoken.response, 'elevenlabs');
          return runner.run();
        })
        .then((result) => {
          record.readiness = result.readiness;
          record.reason = result.reason;
          record.terminalResult = result;
          record.status = result.status;
          hub.publishTerminal(result);
          return result;
        })
        .catch((error: unknown) => {
          const reason =
            error instanceof Error ? error.message : 'phone-first learning loop failed';
          record.status = 'failed';
          record.reason = reason;
          if (record.closure?.status === 'awaiting_response') {
            record.closure = {
              ...record.closure,
              status: 'failed',
              closedAt: new Date().toISOString(),
            };
          }
          hub.publishFailure(reason);
          throw error;
        });
      void record.completion.catch(() => undefined);
      return this.snapshot(record);
    }

    record.completion = runner
      .run()
      .then(async (result) => {
        record.readiness = result.readiness;
        record.reason = result.reason;
        record.terminalResult = result;
        if (this.closurePort === null) {
          record.status = result.status;
          hub.publishTerminal(result);
          return result;
        }

        const closureContext = loopClosureContext(id, result, closureToNumber);
        const receipt = await this.closurePort.requestClosure(closureContext);
        record.closure = {
          status: 'awaiting_response',
          conversationId: receipt.conversationId,
          callSid: receipt.callSid ?? null,
          responseDigest: null,
          closedAt: null,
        };
        record.status = 'awaiting_human';
        hub.publishClosureRequested(receipt.conversationId);
        if (this.closurePort.waitForSpokenResponse !== undefined) {
          void this.closurePort
            .waitForSpokenResponse(receipt, closureContext)
            .then((spoken) => this.closeWithSpokenResponse(spoken))
            .catch((error: unknown) => {
              const reason =
                error instanceof Error ? error.message : 'phone transcript polling failed';
              try {
                this.failLoopClosure(receipt.conversationId, reason);
              } catch {
                // A signed webhook may have closed the same conversation first.
              }
            });
        }
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

  closeWithSpokenResponse(input: SpokenLoopClosure): EpisodeRunSnapshot {
    const record = this.runs.get(input.loopId);
    if (record === undefined) throw new LoopClosureNotFoundError(input.loopId);
    if (record.closure === null || record.terminalResult === null) {
      throw new LoopClosureConflictError('the loop is not awaiting a phone response');
    }
    if (record.closure.conversationId !== input.conversationId) {
      throw new LoopClosureConflictError('the conversation does not match the pending loop');
    }
    const responseDigest = createHash('sha256').update(input.response).digest('hex');
    if (record.closure.status === 'received') {
      if (record.closure.responseDigest !== responseDigest) {
        throw new LoopClosureConflictError('the loop was already closed with another response');
      }
      return this.snapshot(record);
    }
    if (record.closure.status !== 'awaiting_response') {
      throw new LoopClosureConflictError('the phone closure is no longer pending');
    }

    record.closure = {
      ...record.closure,
      status: 'received',
      responseDigest,
      closedAt: new Date().toISOString(),
    };
    record.status = record.terminalResult.status;
    record.reason = record.terminalResult.reason;
    record.hub.publishManualVoiceAttack(input.response, 'elevenlabs');
    record.hub.publishTerminal(record.terminalResult);
    return this.snapshot(record);
  }

  failLoopClosure(conversationId: string, reason: string): EpisodeRunSnapshot {
    const record = [...this.runs.values()].find(
      (candidate) => candidate.closure?.conversationId === conversationId,
    );
    if (record === undefined) throw new LoopClosureNotFoundError(conversationId);
    if (record.closure === null) throw new LoopClosureNotFoundError(conversationId);
    if (record.closure.status === 'failed') return this.snapshot(record);
    if (record.closure.status !== 'awaiting_response') {
      throw new LoopClosureConflictError('the phone closure is no longer pending');
    }

    const safeReason = reason.trim().slice(0, 512) || 'phone closure failed';
    record.closure = {
      ...record.closure,
      status: 'failed',
      closedAt: new Date().toISOString(),
    };
    record.status = 'failed';
    record.reason = safeReason;
    record.hub.publishFailure(safeReason);
    return this.snapshot(record);
  }

  async executeProtectedSchedule(
    runId: string,
    input: ProtectedScheduleInput,
  ): Promise<ProtectedSchedule> {
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
    const scheduled = await this.scheduleScreen(runId, input);
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
      closure:
        record.closure === null
          ? null
          : {
              status: record.closure.status,
              conversationId: record.closure.conversationId,
              responseReceived: record.closure.responseDigest !== null,
              closedAt: record.closure.closedAt,
            },
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

  private liveZeroRuntime(): LiveZeroPortRuntime | null {
    if (this.config.ZERO_MODE !== 'live') return null;
    if (this.options.liveZeroRuntime !== undefined) return this.options.liveZeroRuntime;
    const allowedCapabilityRefs = this.config.ZERO_ALLOWED_CAPABILITY_REFS;
    const allowedTargetDomains = this.config.ZERO_ALLOWED_TARGET_DOMAINS;
    const targetBaseUrl = this.config.ZERO_TARGET_BASE_URL;
    if (
      allowedCapabilityRefs === undefined ||
      allowedTargetDomains === undefined ||
      targetBaseUrl === undefined
    ) {
      throw new Error('live Zero requires explicit capability and target-domain allowlists');
    }
    return createLiveZeroPort({
      binary: this.config.ZERO_RUNNER,
      timeoutMs: this.config.ZERO_TIMEOUT_MS,
      allowedCapabilityRefs,
      allowedTargetDomains,
      maxPerCallMicroUsd: Math.round(this.config.ZERO_MAX_PER_CALL_USD * 1_000_000),
      maxEpisodeMicroUsd: Math.round(this.config.LOOP_MAX_ZERO_SPEND_USD * 1_000_000),
      claimTargetResolver: createSyntheticClaimTargetResolver(targetBaseUrl, allowedTargetDomains),
    });
  }

  private recruitingOps(ids: NamespacedIdGenerator): RecruitingOpsPort {
    if (this.config.RECRUITING_OPS_MODE !== 'http') {
      return new FakeRecruitingOpsPort({ ids });
    }
    return new HttpOutboundRecruitingOpsPort({
      baseUrl: requiredConfig(
        this.config.OUTBOUND_RECRUITING_BASE_URL,
        'OUTBOUND_RECRUITING_BASE_URL',
      ),
      bearerToken: requiredConfig(
        this.config.OUTBOUND_RECRUITING_BEARER_TOKEN,
        'OUTBOUND_RECRUITING_BEARER_TOKEN',
      ),
      timeoutMs: this.config.OUTBOUND_RECRUITING_TIMEOUT_MS,
      ids,
      allowlist: {
        roleIds: ['role-loop-engineer'],
        candidateIds: ['candidate-red', 'candidate-control'],
        templateIds: ['outreach-loop-role-v1'],
        eventIds: [
          'reply-authority-red',
          'reply-urgency-red',
          'reply-portfolio-red',
          'reply-credential-red',
        ],
        sandboxIds: ['sandbox-hackathon'],
        sandboxCalendarIds: ['calendar-sandbox'],
      },
    });
  }

  private calendarPort(): CalendarSchedulePort | null {
    if (this.config.CALENDAR_MODE !== 'google') return null;
    return createGoogleCalendarSandboxPort({
      accessToken: requiredConfig(
        this.config.GOOGLE_CALENDAR_OAUTH_ACCESS_TOKEN,
        'GOOGLE_CALENDAR_OAUTH_ACCESS_TOKEN',
      ),
      sandboxCalendarId: requiredConfig(
        this.config.GOOGLE_CALENDAR_SANDBOX_ID,
        'GOOGLE_CALENDAR_SANDBOX_ID',
      ),
      timeoutMs: this.config.GOOGLE_CALENDAR_TIMEOUT_MS,
    });
  }

  private async scheduleScreen(
    runId: string,
    input: ProtectedScheduleInput,
  ): Promise<ProtectedSchedule> {
    if (this.calendar === null) {
      return {
        ...input,
        operationId: `pomerium-screen-${createHash('sha256')
          .update(`${runId}:${input.episodeId}`)
          .digest('hex')
          .slice(0, 24)}`,
        idempotentReplay: false,
      };
    }
    const result = await this.calendar.scheduleScreen({
      sandboxCalendarId: requiredConfig(
        this.config.GOOGLE_CALENDAR_SANDBOX_ID,
        'GOOGLE_CALENDAR_SANDBOX_ID',
      ),
      episodeId: input.episodeId,
      evidenceId: input.evidenceId,
      candidateId: input.candidateId,
      roleId: input.roleId,
      attendeeEmail: requiredConfig(
        this.config.SANDBOX_CALENDAR_ATTENDEE_EMAIL,
        'SANDBOX_CALENDAR_ATTENDEE_EMAIL',
      ),
      title: this.config.SANDBOX_SCREEN_TITLE,
      description: this.config.SANDBOX_SCREEN_DESCRIPTION,
      startAt: requiredConfig(this.config.SANDBOX_SCREEN_START_AT, 'SANDBOX_SCREEN_START_AT'),
      endAt: requiredConfig(this.config.SANDBOX_SCREEN_END_AT, 'SANDBOX_SCREEN_END_AT'),
    });
    return { ...input, ...result };
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

export class LoopClosureNotFoundError extends Error {
  public constructor(id: string) {
    super(`No pending phone closure was found for ${id}.`);
    this.name = 'LoopClosureNotFoundError';
  }
}

export class LoopClosureConflictError extends Error {}

function withoutOperation(schedule: ProtectedSchedule): ProtectedScheduleInput {
  return {
    episodeId: schedule.episodeId,
    evidenceId: schedule.evidenceId,
    candidateId: schedule.candidateId,
    roleId: schedule.roleId,
    sandboxCalendarId: schedule.sandboxCalendarId,
  };
}

function loopClosureContext(
  loopId: string,
  result: LearningLoopResult,
  toNumber?: string,
): LoopClosureContext {
  return {
    loopId,
    ...(toNumber === undefined ? {} : { toNumber }),
    resultStatus: result.status,
    readinessScore: result.readiness.score,
    reason: result.reason.slice(0, 512),
    episodeCount: result.memory.evaluations.length,
    hostileEvaluations: result.readiness.hostileEvaluations,
    legitimateControls: result.readiness.legitimateControls,
    attackFamiliesCovered: result.readiness.attackFamiliesCovered,
  };
}

function phoneFirstClosureContext(loopId: string, toNumber?: string): LoopClosureContext {
  return {
    loopId,
    ...(toNumber === undefined ? {} : { toNumber }),
    resultStatus: 'complete',
    readinessScore: 0,
    reason: 'Live caller response will be evaluated by the recruiting loop.',
    episodeCount: 0,
    hostileEvaluations: 0,
    legitimateControls: 0,
    attackFamiliesCovered: 0,
  };
}

function createLoopClosurePort(config: AppConfig): LoopClosurePort | null {
  if (!config.ELEVENLABS_LOOP_CLOSURE_ENABLED) return null;
  const apiKey = requiredConfig(config.ELEVENLABS_API_KEY, 'ELEVENLABS_API_KEY');
  const agentId = requiredConfig(config.ELEVENLABS_AGENT_ID, 'ELEVENLABS_AGENT_ID');
  const agentPhoneNumberId = requiredConfig(
    config.ELEVENLABS_PHONE_NUMBER_ID,
    'ELEVENLABS_PHONE_NUMBER_ID',
  );
  const toNumber = requiredConfig(config.ELEVENLABS_TO_NUMBER, 'ELEVENLABS_TO_NUMBER');
  return new ElevenLabsLoopClosureClient({ apiKey, agentId, agentPhoneNumberId, toNumber });
}

function requiredConfig(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}
