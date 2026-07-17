import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  createInitialPresentationState,
  reducePresentation,
  replayEvents,
  type GameEvent,
} from '../../public/app.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../public/fixtures/hire-me-if-you-can-events.json', import.meta.url),
    'utf8',
  ),
) as { events: GameEvent[] };

function replayThrough(kind: string) {
  const index = fixture.events.findIndex((event) => event.kind === kind);
  if (index < 0) throw new Error(`Fixture does not contain ${kind}`);
  return replayEvents(fixture.events.slice(0, index + 1));
}

function eventAt(index: number): GameEvent {
  const event = fixture.events[index];
  if (!event) throw new Error(`Fixture does not contain event ${index}`);
  return event;
}

describe('recruiting presentation reducer', () => {
  it('shows a contained scheduling attempt without a calendar side effect', () => {
    const state = replayThrough('policy_denied');

    expect(state.gate).toMatchObject({
      state: 'denied',
      identity: 'fillmore-sourcing-agent',
      tool: 'fillmore_schedule_screen',
    });
    expect(state.red.sprite).toBe('blocked');
    expect(state.calendar.state).toBe('locked');
    expect(state.metrics).toMatchObject({ redFlags: 1, policyBreaches: 0 });
  });

  it('makes the same-tool deny/allow identity difference explicit', () => {
    const denied = replayThrough('policy_denied');
    const allowed = replayThrough('policy_allowed');

    expect(allowed.gate.tool).toBe(denied.gate.tool);
    expect(denied.gate.identity).toBe('fillmore-sourcing-agent');
    expect(allowed.gate.identity).toBe('hiring-controller');
    expect(denied.gate.state).toBe('denied');
    expect(allowed.gate.state).toBe('allowed');
  });

  it('reaches the expected terminal state from the complete fixture', () => {
    const state = replayEvents(fixture.events);

    expect(state.episodeStatus).toBe('complete');
    expect(state.lastSequence).toBe(16);
    expect(state.candidate).toMatchObject({
      displayName: 'Ari Stack',
      status: 'verified-for-screen',
    });
    expect(state.calendar).toMatchObject({
      state: 'scheduled',
      title: '[HACKATHON TEST] Ari Stack — Screening',
    });
    expect(state.metrics).toEqual({ redFlags: 1, whiteSaves: 1, policyBreaches: 0 });
    expect(state.researcher.memory[0]).toContain('independent evidence');
    expect(state.red.sprite).toBe('blocked');
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
    expect(gapped.lastSequence).toBe(0);
    expect(gapped.gap).toEqual({ expected: 1, received: 2 });
    expect(gapped.outcome).toBe('SNAPSHOT REQUIRED');
  });

  it('records unknown event kinds safely and continues', () => {
    const first = reducePresentation(createInitialPresentationState(), eventAt(0));
    const unknown: GameEvent = {
      ...eventAt(1),
      id: 'evt-future-001',
      kind: 'future_sponsor_observation',
    };
    const observed = reducePresentation(first, unknown);
    const continued = reducePresentation(observed, eventAt(2));

    expect(observed.unknownEvents).toBe(1);
    expect(observed.trace.at(-1)?.recognized).toBe(false);
    expect(continued.lastSequence).toBe(2);
    expect(continued.candidate.status).toBe('enriched');
  });
});
