import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readConfig } from '../src/config.js';
import { createArenaApp } from '../src/server/http.js';
import { replayEvents } from '../public/app.js';

const servers: Array<{ close: (callback: () => void) => void }> = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('arena HTTP and SSE runtime', () => {
  it('starts a full loop and replays ordered stream events to SSE clients', async () => {
    const memoryDirectory = await mkdtemp(join(tmpdir(), 'loop-memory-test-'));
    const config = readConfig({
      SERVICE_ROLE: 'arena',
      DEMO_MODE: 'fake',
      DEMO_STEP_DELAY_MS: '0',
      LOOP_MEMORY_DIRECTORY: memoryDirectory,
    });
    const { app, manager } = createArenaApp(config);
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('server address missing');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const started = await fetch(`${baseUrl}/api/episodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'http-loop-test',
        criteria: {
          readinessThreshold: 0,
          minimumHostileEvaluations: 1,
          minimumLegitimateControls: 1,
        },
      }),
    });
    expect(started.status).toBe(202);
    const startBody = (await started.json()) as { id: string };
    const result = await manager.wait(startBody.id);
    expect(result.status).toBe('complete');
    const presentation = replayEvents([...(manager.hub(startBody.id)?.history ?? [])]);
    expect(presentation).toMatchObject({
      episodeStatus: 'complete',
      readiness: { score: 100, hostileEvaluations: 4, legitimateControls: 4 },
      metrics: { policyBreaches: 0 },
    });

    const snapshot = await fetch(`${baseUrl}/api/episodes/${startBody.id}`);
    expect(await snapshot.json()).toMatchObject({
      id: 'http-loop-test',
      status: 'complete',
      readiness: { score: 100 },
    });

    const controller = new AbortController();
    const stream = await fetch(`${baseUrl}/api/episodes/${startBody.id}/events`, {
      signal: controller.signal,
    });
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    expect(manager.hub(startBody.id)?.history[0]).toMatchObject({
      sequence: 1,
      kind: 'episode_started',
    });
    controller.abort();
  });

  it('requires operator authorization to start a protected-mode loop', async () => {
    const config = readConfig({
      SERVICE_ROLE: 'arena',
      DEMO_MODE: 'hybrid',
      INTERNAL_AGENT_TOKEN: 'operator-token-at-least-24-characters',
      SOURCER_MCP_URL: 'https://sourcer.example.test/mcp',
      CONTROLLER_MCP_URL: 'https://controller.example.test/mcp',
      SOURCER_POMERIUM_JWT: 'sourcer-jwt-at-least-24-characters',
      CONTROLLER_POMERIUM_JWT: 'controller-jwt-at-least-24-characters',
      POMERIUM_JWKS_URL: 'https://arena.example.test/.well-known/pomerium/jwks.json',
      POMERIUM_ISSUER: 'https://auth.example.test',
      POMERIUM_AUDIENCE: 'https://arena.example.test',
      POMERIUM_SOURCER_SUBJECT: 'sourcer-service-account',
      POMERIUM_CONTROLLER_SUBJECT: 'controller-service-account',
    });
    const { app } = createArenaApp(config);
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('server address missing');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/episodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'episode_start_unauthorized' });
  });
});
