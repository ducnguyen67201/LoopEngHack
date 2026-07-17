import { resolve } from 'node:path';

import express, { type Express, type Request, type Response } from 'express';

import type { GameEvent } from '../domain/types.js';
import {
  EpisodeActiveError,
  EpisodeCapacityError,
  EpisodeConflictError,
  EpisodeNotFoundError,
  EpisodeRuntime,
} from '../runtime/episode-runtime.js';

export interface HttpAppOptions {
  runtime?: EpisodeRuntime;
  publicDirectory?: string;
  fixtureDirectory?: string;
}

export function createHttpApp(options: HttpAppOptions = {}): Express {
  const runtime = options.runtime ?? new EpisodeRuntime();
  const publicDirectory = options.publicDirectory ?? resolve(process.cwd(), 'public');
  const fixtureDirectory = options.fixtureDirectory ?? resolve(process.cwd(), 'fixtures');
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.get('/health/live', (_request, response) => {
    response.json({ status: 'ok', service: 'recruiting-arena' });
  });

  app.post('/api/episodes', (_request, response) => {
    try {
      const started = runtime.createEpisode();
      const encodedId = encodeURIComponent(started.episodeId);
      response.status(202).json({
        ...started,
        eventsUrl: `/api/episodes/${encodedId}/events`,
        snapshotUrl: `/api/episodes/${encodedId}`,
        uiUrl: `/?mode=live&episode=${encodedId}`,
      });
    } catch (error) {
      sendRuntimeError(response, error);
    }
  });

  app.get('/api/episodes/:episodeId', (request, response) => {
    try {
      response.json(runtime.getSnapshot(request.params.episodeId));
    } catch (error) {
      sendRuntimeError(response, error);
    }
  });

  app.get('/api/episodes/:episodeId/events', (request, response) => {
    const episodeId = request.params.episodeId;
    let lastSequence: number;
    try {
      lastSequence = readLastSequence(request);
      runtime.getSnapshot(episodeId);
    } catch (error) {
      sendRuntimeError(response, error);
      return;
    }

    response.status(200);
    response.set({
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write('retry: 2000\n\n');

    for (const event of runtime.eventsAfter(episodeId, lastSequence)) writeEvent(response, event);
    const unsubscribe = runtime.subscribe(episodeId, (event) => writeEvent(response, event));
    const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), 15_000);

    request.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.use('/fixtures', express.static(fixtureDirectory));
  app.use(express.static(publicDirectory, { extensions: ['html'] }));
  app.use('/api', (_request, response) => response.status(404).json({ error: 'not_found' }));
  app.use((_request, response) => response.status(404).end());

  return app;
}

function readLastSequence(request: Request): number {
  const raw = request.get('Last-Event-ID') ?? request.query.lastSequence ?? '0';
  const value = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Last-Event-ID must be a non-negative safe integer.');
  }
  return value;
}

function writeEvent(response: Response, event: GameEvent): void {
  response.write(`id: ${event.sequence}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function sendRuntimeError(response: Response, error: unknown): void {
  if (error instanceof EpisodeActiveError) {
    response.status(409).json({ error: 'episode_active' });
    return;
  }
  if (error instanceof EpisodeConflictError) {
    response.status(409).json({ error: 'episode_conflict' });
    return;
  }
  if (error instanceof EpisodeCapacityError) {
    response.status(429).json({ error: 'episode_capacity_reached' });
    return;
  }
  if (error instanceof EpisodeNotFoundError) {
    response.status(404).json({ error: 'episode_not_found' });
    return;
  }
  if (error instanceof RangeError) {
    response.status(400).json({ error: 'invalid_resume_sequence' });
    return;
  }
  response.status(500).json({ error: 'runtime_failure' });
}
