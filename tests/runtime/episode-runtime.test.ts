import { describe, expect, it } from 'vitest';

import {
  EpisodeActiveError,
  EpisodeCapacityError,
  EpisodeConflictError,
  EpisodeNotFoundError,
  EpisodeRuntime,
} from '../../src/runtime/episode-runtime.js';

describe('EpisodeRuntime', () => {
  it('runs the coordinator and retains an ordered resumable event stream', async () => {
    const runtime = new EpisodeRuntime({ idFactory: () => 'episode-stream-test' });

    const started = runtime.createEpisode();
    expect(started).toMatchObject({ episodeId: 'episode-stream-test', status: 'running' });

    await runtime.waitForCompletion(started.episodeId);
    const snapshot = runtime.getSnapshot(started.episodeId);

    expect(snapshot).toMatchObject({
      episodeId: 'episode-stream-test',
      status: 'complete',
      lastSequence: 21,
      eventCount: 21,
    });
    expect(runtime.eventsAfter(started.episodeId, 16).map((event) => event.sequence)).toEqual([
      17, 18, 19, 20, 21,
    ]);
  });

  it('publishes canonical events to subscribers as the engine emits them', async () => {
    const runtime = new EpisodeRuntime({ idFactory: () => 'episode-subscriber-test' });
    const observed: number[] = [];
    const started = runtime.createEpisode();
    const unsubscribe = runtime.subscribe(started.episodeId, (event) => {
      observed.push(event.sequence);
    });

    await runtime.waitForCompletion(started.episodeId);
    unsubscribe();

    expect(observed).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
  });

  it('rejects a concurrent episode before another side-effecting loop can start', async () => {
    let sequence = 0;
    const runtime = new EpisodeRuntime({ idFactory: () => `episode-active-${++sequence}` });
    const started = runtime.createEpisode();

    expect(() => runtime.createEpisode()).toThrow(EpisodeActiveError);
    await runtime.waitForCompletion(started.episodeId);
    const restarted = runtime.createEpisode();
    expect(restarted).toMatchObject({ status: 'running' });
    await runtime.waitForCompletion(restarted.episodeId);
  });

  it('bounds retained episodes and releases completed records after their TTL', async () => {
    let now = 1_000;
    let sequence = 0;
    const runtime = new EpisodeRuntime({
      idFactory: () => `episode-retention-${++sequence}`,
      maxRetainedEpisodes: 1,
      completedEpisodeTtlMs: 100,
      now: () => now,
    });
    const first = runtime.createEpisode();
    await runtime.waitForCompletion(first.episodeId);

    expect(() => runtime.createEpisode()).toThrow(EpisodeCapacityError);
    now += 101;
    expect(() => runtime.getSnapshot(first.episodeId)).toThrow(EpisodeNotFoundError);

    const second = runtime.createEpisode();
    await runtime.waitForCompletion(second.episodeId);
    expect(second.episodeId).toBe('episode-retention-2');
  });

  it('reports a generated episode identifier collision explicitly', async () => {
    const runtime = new EpisodeRuntime({
      idFactory: () => 'episode-collision',
      maxRetainedEpisodes: 2,
    });
    const first = runtime.createEpisode();
    await runtime.waitForCompletion(first.episodeId);

    expect(() => runtime.createEpisode()).toThrow(EpisodeConflictError);
  });
});
