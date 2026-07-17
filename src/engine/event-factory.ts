import { gameEventSchema } from '../domain/schemas.js';
import type { Clock, EventSink, IdGenerator } from '../domain/ports.js';
import type { GameEvent, GameEventDraft, RecruitingGameState } from '../domain/types.js';

export class EventFactory {
  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly sink: EventSink,
  ) {}

  create(state: RecruitingGameState, draft: GameEventDraft): GameEvent {
    if (state.episode === null) throw new Error('cannot emit an event before an episode starts');
    if (draft.episodeId !== state.episode.id) throw new Error('event episode does not match state');

    const event = gameEventSchema.parse({
      ...draft,
      id: this.ids.next('event'),
      sequence: state.nextSequence,
      occurredAt: this.clock.now(),
    });
    this.sink.append(event);
    return event;
  }
}
