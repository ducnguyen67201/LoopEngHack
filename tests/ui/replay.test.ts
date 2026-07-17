import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createInitialPresentationState,
  recoverPresentationSnapshot,
  reducePresentation,
  type GameEvent,
} from '../../public/app.js';
import { LiveEventSource } from '../../public/replay.js';

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/recruiting-contract-events.json', import.meta.url), 'utf8'),
) as { events: GameEvent[] };

afterEach(() => vi.unstubAllGlobals());

describe('live UI recovery', () => {
  it('replaces a gapped presentation with the authoritative episode snapshot', async () => {
    const first = reducePresentation(createInitialPresentationState('live'), fixture.events[0]!);
    const gapped = reducePresentation(first, fixture.events[2]!);
    expect(gapped.connection).toBe('gap');

    const fetcher = vi.fn(() =>
      Promise.resolve(
        Response.json({
          episodeId: fixture.events[0]!.episodeId,
          lastSequence: fixture.events.length,
          events: fixture.events,
        }),
      ),
    );
    const recovered = await recoverPresentationSnapshot(fixture.events[0]!.episodeId, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      `/api/episodes/${fixture.events[0]!.episodeId}`,
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    expect(recovered.state).toMatchObject({
      episodeStatus: 'complete',
      lastSequence: 21,
      gap: null,
    });
  });

  it('reconnects SSE from the recovered snapshot sequence', () => {
    const openedUrls: string[] = [];
    class FakeEventSource {
      public constructor(url: string) {
        openedUrls.push(url);
      }
      public addEventListener(): void {}
      public close(): void {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);

    const source = new LiveEventSource({ episodeId: 'episode-recovery-test' });
    source.connect(16);

    expect(openedUrls).toEqual(['/api/episodes/episode-recovery-test/events?lastSequence=16']);
  });
});
