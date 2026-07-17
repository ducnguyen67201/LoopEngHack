import { randomUUID } from 'node:crypto';

import type { GameEvent, RecruitingGameState } from '../domain/types.js';
import type { EventSink } from '../domain/ports.js';
import { RecruitingLoopCoordinator } from '../engine/coordinator.js';
import {
  FakeClock,
  FakeIdGenerator,
  FakePolicyPort,
  FakeRecruitingOpsPort,
  FakeZeroPort,
} from '../engine/fakes/index.js';
import { BufferedEventSink, type GameEventListener } from './buffered-event-sink.js';

export type EpisodeRuntimeStatus = 'running' | 'complete' | 'failed';

export interface EpisodeStarted {
  episodeId: string;
  status: 'running';
}

export interface EpisodeSnapshot {
  episodeId: string;
  status: EpisodeRuntimeStatus;
  lastSequence: number;
  eventCount: number;
  events: readonly GameEvent[];
  error?: string;
}

export interface EpisodeRuntimeOptions {
  idFactory?: () => string;
  coordinatorFactory?: (events: EventSink) => RecruitingLoopCoordinator;
  maxRetainedEpisodes?: number;
  completedEpisodeTtlMs?: number;
  now?: () => number;
}

interface EpisodeRecord {
  readonly episodeId: string;
  readonly events: BufferedEventSink;
  completion: Promise<RecruitingGameState | null>;
  status: EpisodeRuntimeStatus;
  state: RecruitingGameState | null;
  completedAt?: number;
  error?: string;
}

export class EpisodeNotFoundError extends Error {
  public constructor(episodeId: string) {
    super(`Episode ${episodeId} was not found.`);
    this.name = 'EpisodeNotFoundError';
  }
}

export class EpisodeActiveError extends Error {
  public constructor(episodeId: string) {
    super(`Episode ${episodeId} is still running.`);
    this.name = 'EpisodeActiveError';
  }
}

export class EpisodeConflictError extends Error {
  public constructor(episodeId: string) {
    super(`Episode ${episodeId} already exists.`);
    this.name = 'EpisodeConflictError';
  }
}

export class EpisodeCapacityError extends Error {
  public constructor() {
    super('The retained episode limit has been reached.');
    this.name = 'EpisodeCapacityError';
  }
}

/** Owns in-process episodes while keeping all sponsor adapters server-side. */
export class EpisodeRuntime {
  private readonly coordinatorFactory: (events: EventSink) => RecruitingLoopCoordinator;
  private readonly idFactory: () => string;
  private readonly maxRetainedEpisodes: number;
  private readonly completedEpisodeTtlMs: number;
  private readonly now: () => number;
  private readonly records = new Map<string, EpisodeRecord>();

  public constructor(options: EpisodeRuntimeOptions = {}) {
    this.idFactory = options.idFactory ?? (() => `episode-${randomUUID()}`);
    this.coordinatorFactory = options.coordinatorFactory ?? createFakeCoordinator;
    this.maxRetainedEpisodes = options.maxRetainedEpisodes ?? 20;
    this.completedEpisodeTtlMs = options.completedEpisodeTtlMs ?? 15 * 60 * 1000;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.maxRetainedEpisodes) || this.maxRetainedEpisodes < 1) {
      throw new RangeError('maxRetainedEpisodes must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(this.completedEpisodeTtlMs) || this.completedEpisodeTtlMs < 1) {
      throw new RangeError('completedEpisodeTtlMs must be a positive safe integer.');
    }
  }

  public createEpisode(): EpisodeStarted {
    this.pruneExpiredRecords();
    const active = [...this.records.values()].find(({ status }) => status === 'running');
    if (active !== undefined) throw new EpisodeActiveError(active.episodeId);
    if (this.records.size >= this.maxRetainedEpisodes) throw new EpisodeCapacityError();

    const episodeId = this.idFactory();
    if (this.records.has(episodeId)) throw new EpisodeConflictError(episodeId);

    const events = new BufferedEventSink(episodeId);
    const coordinator = this.coordinatorFactory(events);
    const record: EpisodeRecord = {
      episodeId,
      events,
      status: 'running',
      state: null,
      completion: Promise.resolve(null),
    };
    this.records.set(episodeId, record);

    record.completion = Promise.resolve()
      .then(() => coordinator.runToCompletion(episodeId))
      .then((state) => {
        record.state = state;
        record.status = 'complete';
        record.completedAt = this.now();
        return state;
      })
      .catch(() => {
        record.status = 'failed';
        record.completedAt = this.now();
        record.error = 'Episode failed safely.';
        try {
          record.events.append({
            schemaVersion: 1,
            id: `runtime-error-${randomUUID()}`,
            episodeId,
            sequence: record.events.lastSequence + 1,
            turn: 0,
            phase: 'observe',
            kind: 'error',
            actor: 'arena',
            summary: 'The episode stopped safely before another action.',
            visualCue: 'error',
            payload: { errorCategory: 'runtime_failure' },
            occurredAt: new Date().toISOString(),
          });
        } catch {
          // Preserve the original safe failure state if the event sink itself failed.
        }
        return null;
      });

    return { episodeId, status: 'running' };
  }

  public getSnapshot(episodeId: string): EpisodeSnapshot {
    const record = this.record(episodeId);
    return {
      episodeId,
      status: record.status,
      lastSequence: record.events.lastSequence,
      eventCount: record.events.eventCount,
      events: record.events.eventsAfter(0),
      ...(record.error === undefined ? {} : { error: record.error }),
    };
  }

  public eventsAfter(episodeId: string, sequence: number): readonly GameEvent[] {
    return this.record(episodeId).events.eventsAfter(sequence);
  }

  public subscribe(episodeId: string, listener: GameEventListener): () => void {
    return this.record(episodeId).events.subscribe(listener);
  }

  public async waitForCompletion(episodeId: string): Promise<RecruitingGameState | null> {
    return this.record(episodeId).completion;
  }

  private record(episodeId: string): EpisodeRecord {
    this.pruneExpiredRecords();
    const record = this.records.get(episodeId);
    if (record === undefined) throw new EpisodeNotFoundError(episodeId);
    return record;
  }

  private pruneExpiredRecords(): void {
    const expiresBefore = this.now() - this.completedEpisodeTtlMs;
    for (const [episodeId, record] of this.records) {
      if (record.completedAt !== undefined && record.completedAt <= expiresBefore) {
        this.records.delete(episodeId);
      }
    }
  }
}

function createFakeCoordinator(events: EventSink): RecruitingLoopCoordinator {
  const ids = new FakeIdGenerator();
  return new RecruitingLoopCoordinator({
    recruitingOps: new FakeRecruitingOpsPort({ ids }),
    zero: new FakeZeroPort({ ids }),
    // Pomerium work can replace only this injected port; the runtime and UI
    // stream do not depend on its concrete implementation.
    policy: new FakePolicyPort({ ids }),
    clock: new FakeClock(),
    ids,
    events,
  });
}
