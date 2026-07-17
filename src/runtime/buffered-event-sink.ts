import { gameEventSchema } from '../domain/schemas.js';
import type { EventSink } from '../domain/ports.js';
import type { GameEvent } from '../domain/types.js';

export type GameEventListener = (event: GameEvent) => void;

/**
 * Episode-scoped event buffer used by snapshots and SSE. The engine remains the
 * only producer; consumers receive cloned, schema-validated events.
 */
export class BufferedEventSink implements EventSink {
  private readonly listeners = new Set<GameEventListener>();
  private readonly storedEvents: GameEvent[] = [];

  public constructor(private readonly episodeId: string) {}

  public append(event: GameEvent): void {
    const parsed = gameEventSchema.parse(event);
    if (parsed.episodeId !== this.episodeId) {
      throw new Error('Event episode does not match the stream buffer.');
    }

    const expectedSequence = this.storedEvents.length + 1;
    if (parsed.sequence !== expectedSequence) {
      throw new Error(`Event sequence must be ${expectedSequence}.`);
    }
    if (this.storedEvents.some(({ id }) => id === parsed.id)) {
      throw new Error('Duplicate event identifiers are not allowed.');
    }

    const stored = structuredClone(parsed);
    this.storedEvents.push(stored);
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(stored));
      } catch {
        // A disconnected/slow transport must never fail the engine producer.
        this.listeners.delete(listener);
      }
    }
  }

  public eventsAfter(sequence: number): readonly GameEvent[] {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new RangeError('Resume sequence must be a non-negative safe integer.');
    }
    return this.storedEvents
      .filter((event) => event.sequence > sequence)
      .map((event) => structuredClone(event));
  }

  public subscribe(listener: GameEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public get lastSequence(): number {
    return this.storedEvents.at(-1)?.sequence ?? 0;
  }

  public get eventCount(): number {
    return this.storedEvents.length;
  }
}
