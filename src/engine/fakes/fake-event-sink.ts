import type { EventSink } from '../../domain/ports.js';
import { gameEventSchema } from '../../domain/schemas.js';
import type { GameEvent } from '../../domain/types.js';

/** Strict in-memory sink for the single deterministic hackathon episode. */
export class FakeEventSink implements EventSink {
  private readonly storedEvents: GameEvent[] = [];

  public append(event: GameEvent): void {
    const parsed = gameEventSchema.parse(event);
    const expectedSequence = this.storedEvents.length + 1;

    if (parsed.sequence !== expectedSequence) {
      throw new Error(`Event sequence must be ${expectedSequence}.`);
    }

    if (this.storedEvents.some(({ id }) => id === parsed.id)) {
      throw new Error('Duplicate event identifiers are not allowed.');
    }

    this.storedEvents.push(structuredClone(parsed));
  }

  public get events(): readonly GameEvent[] {
    return this.storedEvents.map((event) => structuredClone(event));
  }
}
