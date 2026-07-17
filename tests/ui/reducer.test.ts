import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  KNOWN_EVENT_KINDS,
  createInitialPresentationState,
  reducePresentation,
  replayEvents,
  type GameEvent,
} from '../../public/app.js';
import { runFakeRecruitingEpisode } from '../../src/engine/simulator.js';
import { eventKindSchema } from '../../src/domain/schemas.js';

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/recruiting-contract-events.json', import.meta.url), 'utf8'),
) as { events: GameEvent[] };

function replayThrough(kind: string, matches: (event: GameEvent) => boolean = () => true) {
  const index = fixture.events.findIndex((event) => event.kind === kind && matches(event));
  if (index < 0) throw new Error(`Fixture does not contain ${kind}`);
  return replayEvents(fixture.events.slice(0, index + 1));
}

function eventAt(index: number): GameEvent {
  const event = fixture.events[index];
  if (!event) throw new Error(`Fixture does not contain event ${index}`);
  return event;
}

describe('recruiting presentation reducer', () => {
  it('recognizes exactly the canonical domain event kinds', () => {
    expect([...KNOWN_EVENT_KINDS].sort()).toEqual(
      [
        ...eventKindSchema.options,
        'inner_episode_completed',
        'learning_episode_completed',
        'loop_completed',
      ].sort(),
    );
  });

  it('shows a contained scheduling attempt without a calendar side effect', () => {
    const state = replayThrough('policy_decision', (event) => event.payload.decision === 'deny');

    expect(state.gate).toMatchObject({
      state: 'denied',
      identity: 'outbound-sourcer',
      tool: 'recruiting_schedule_screen',
    });
    expect(state.red.sprite).toBe('blocked');
    expect(state.calendar.state).toBe('locked');
    expect(state.metrics).toMatchObject({ redFlags: 1, policyBreaches: 0 });
  });

  it('makes the same-tool deny/allow identity difference explicit', () => {
    const denied = replayThrough('policy_decision', (event) => event.payload.decision === 'deny');
    const allowed = replayThrough('policy_decision', (event) => event.payload.decision === 'allow');

    expect(allowed.gate.tool).toBe(denied.gate.tool);
    expect(denied.gate.identity).toBe('outbound-sourcer');
    expect(allowed.gate.identity).toBe('hiring-controller');
    expect(denied.gate.state).toBe('denied');
    expect(allowed.gate.state).toBe('allowed');
  });

  it('reaches the expected terminal state from the complete fixture', () => {
    const state = replayEvents(fixture.events);

    expect(state.episodeStatus).toBe('complete');
    expect(state.lastSequence).toBe(21);
    expect(state.candidate.status).toBe('verified-for-screen');
    expect(state.calendar).toMatchObject({
      state: 'scheduled',
      title: '[HACKATHON TEST] Screening',
    });
    expect(state.metrics).toEqual({ redFlags: 1, whiteSaves: 1, policyBreaches: 0 });
    expect(state.researcher.memory[0]).toContain('regression');
    expect(state.red.sprite).toBe('blocked');
  });

  it('consumes the coordinator output without a presentation translation contract', async () => {
    const episode = await runFakeRecruitingEpisode();
    const state = replayEvents(episode.events);

    expect(state.episodeStatus).toBe('complete');
    expect(state.lastSequence).toBe(21);
    expect(state.unknownEvents).toBe(0);
    expect(state.proof).toMatchObject({
      pomeriumDenyRequestId: 'policy-request-1',
      pomeriumAllowRequestId: 'policy-request-2',
      zeroCapabilityId: 'zero-public-claim-lookup-v1',
      fillmoreOperationId: 'calendar-event-1',
    });
  });

  it('ignores duplicate events idempotently', () => {
    const initial = createInitialPresentationState();
    const firstEvent = eventAt(0);
    const first = reducePresentation(initial, firstEvent);
    const duplicate = reducePresentation(first, firstEvent);

    expect(duplicate).toBe(first);
    expect(duplicate.trace).toHaveLength(1);
  });

  it('pauses on a sequence gap instead of inventing missing state', () => {
    const first = reducePresentation(createInitialPresentationState(), eventAt(0));
    const gapped = reducePresentation(first, eventAt(2));

    expect(gapped.connection).toBe('gap');
    expect(gapped.lastSequence).toBe(1);
    expect(gapped.gap).toEqual({ expected: 2, received: 3 });
    expect(gapped.outcome).toBe('SNAPSHOT REQUIRED');
  });

  it('records unknown event kinds safely and continues', () => {
    const first = reducePresentation(createInitialPresentationState(), eventAt(0));
    const unknown = {
      ...eventAt(1),
      id: 'evt-future-001',
      kind: 'future_sponsor_observation',
    } as unknown as GameEvent;
    const observed = reducePresentation(first, unknown);
    const continued = reducePresentation(observed, eventAt(2));

    expect(observed.unknownEvents).toBe(1);
    expect(observed.trace.at(-1)?.recognized).toBe(false);
    expect(continued.lastSequence).toBe(3);
    expect(continued.candidate.status).toBe('sourced');
  });
});
