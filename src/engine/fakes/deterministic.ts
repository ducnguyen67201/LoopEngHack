import type { Clock, IdGenerator } from '../../domain/ports.js';

const DEFAULT_START_TIME = '2026-07-17T18:00:00.000Z';
const IDENTIFIER_PREFIX = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface DeterministicClockOptions {
  readonly startAt?: string;
}

/** A clock that advances only when explicitly asked to sleep or advance. */
export class DeterministicClock implements Clock {
  private currentTimeMs: number;

  public constructor(options: DeterministicClockOptions = {}) {
    const startAt = options.startAt ?? DEFAULT_START_TIME;
    const startTimeMs = Date.parse(startAt);

    if (!Number.isFinite(startTimeMs)) {
      throw new TypeError('DeterministicClock startAt must be a valid ISO timestamp.');
    }

    this.currentTimeMs = startTimeMs;
  }

  public now(): string {
    return new Date(this.currentTimeMs).toISOString();
  }

  public sleep(milliseconds: number): Promise<void> {
    this.advance(milliseconds);
    return Promise.resolve();
  }

  public advance(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new RangeError('Clock advancement must be a non-negative safe integer.');
    }

    const nextTimeMs = this.currentTimeMs + milliseconds;
    if (!Number.isFinite(nextTimeMs) || Math.abs(nextTimeMs) > 8_640_000_000_000_000) {
      throw new RangeError('Clock advancement exceeds the supported date range.');
    }

    this.currentTimeMs = nextTimeMs;
  }
}

export interface DeterministicIdGeneratorOptions {
  readonly firstSequence?: number;
}

/** Generates stable, independent sequences for each identifier prefix. */
export class DeterministicIdGenerator implements IdGenerator {
  private readonly nextSequenceByPrefix = new Map<string, number>();
  private readonly firstSequence: number;

  public constructor(options: DeterministicIdGeneratorOptions = {}) {
    const firstSequence = options.firstSequence ?? 1;

    if (
      !Number.isSafeInteger(firstSequence) ||
      firstSequence < 0 ||
      firstSequence >= Number.MAX_SAFE_INTEGER
    ) {
      throw new RangeError('firstSequence must be a non-negative safe integer.');
    }

    this.firstSequence = firstSequence;
  }

  public next(prefix: string): string {
    if (prefix.length > 72 || !IDENTIFIER_PREFIX.test(prefix)) {
      throw new TypeError('Identifier prefix must be a bounded identifier.');
    }

    const sequence = this.nextSequenceByPrefix.get(prefix) ?? this.firstSequence;
    if (sequence >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Identifier sequence is exhausted.');
    }

    this.nextSequenceByPrefix.set(prefix, sequence + 1);
    return `${prefix}-${sequence}`;
  }
}
