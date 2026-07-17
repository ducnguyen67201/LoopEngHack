import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { EpisodeRuntime } from '../../src/runtime/episode-runtime.js';
import { createHttpApp } from '../../src/server/http.js';

const servers: Array<{ close(callback: (error?: Error) => void): void }> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

describe('pipeline HTTP server', () => {
  it('starts an episode and streams the canonical engine events over SSE', async () => {
    const runtime = new EpisodeRuntime({ idFactory: () => 'episode-http-test' });
    const app = createHttpApp({ runtime });
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const startedResponse = await fetch(`${baseUrl}/api/episodes`, { method: 'POST' });
    expect(startedResponse.status).toBe(202);
    const started = (await startedResponse.json()) as { episodeId: string; eventsUrl: string };
    expect(started).toEqual({
      episodeId: 'episode-http-test',
      status: 'running',
      eventsUrl: '/api/episodes/episode-http-test/events',
      snapshotUrl: '/api/episodes/episode-http-test',
      uiUrl: '/?mode=live&episode=episode-http-test',
    });

    await runtime.waitForCompletion(started.episodeId);
    const controller = new AbortController();
    const streamResponse = await fetch(`${baseUrl}${started.eventsUrl}`, {
      headers: { 'Last-Event-ID': '19' },
      signal: controller.signal,
    });
    expect(streamResponse.status).toBe(200);
    const reader = streamResponse.body?.getReader();
    if (reader === undefined) throw new Error('SSE response did not contain a body');
    const decoder = new TextDecoder();
    let body = '';
    while (!body.includes('episode_completed')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value as Uint8Array, { stream: true });
    }
    controller.abort();

    expect(body).toContain('id: 20');
    expect(body).toContain('id: 21');
    expect(body).not.toContain('id: 19\n');
    expect(body).toContain('"kind":"episode_completed"');
  });

  it('returns a safe episode snapshot for recovery', async () => {
    const runtime = new EpisodeRuntime({ idFactory: () => 'episode-snapshot-test' });
    const app = createHttpApp({ runtime });
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    runtime.createEpisode();
    await runtime.waitForCompletion('episode-snapshot-test');
    const response = await fetch(`${baseUrl}/api/episodes/episode-snapshot-test`);

    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as { lastSequence: number; events: unknown[] };
    expect(snapshot.lastSequence).toBe(21);
    expect(snapshot.events).toHaveLength(21);
  });

  it('serves the canonical fixture and keeps unknown APIs JSON-only', async () => {
    const app = createHttpApp();
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const fixture = await fetch(`${baseUrl}/fixtures/recruiting-contract-events.json`);
    const unknown = await fetch(`${baseUrl}/api/not-a-route`);

    expect(fixture.status).toBe(200);
    expect(((await fixture.json()) as { events: unknown[] }).events).toHaveLength(21);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'not_found' });
  });

  it('keeps episode startup failures inside the safe JSON API contract', async () => {
    const runtime = new EpisodeRuntime({
      coordinatorFactory: () => {
        throw new Error('sensitive adapter setup detail');
      },
    });
    const app = createHttpApp({ runtime });
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/episodes`, { method: 'POST' });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'runtime_failure' });
  });
});
