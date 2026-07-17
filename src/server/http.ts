import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import type { AppConfig } from '../config.js';
import type { GameEvent } from '../domain/types.js';
import { loopCriteriaSchema, type LoopCriteria } from '../loop/contracts.js';
import {
  EpisodeActiveError,
  EpisodeCapacityError,
  EpisodeConflictError as RuntimeEpisodeConflictError,
  EpisodeNotFoundError,
  EpisodeRuntime,
} from '../runtime/episode-runtime.js';
import {
  EpisodeConflictError as LearningEpisodeConflictError,
  EpisodeManager,
} from '../runtime/episode-manager.js';
import { mountRecruitingMcp } from './mcp.js';
import type { PresentationEvent } from './presentation-events.js';

const startRequestSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/)
      .optional(),
    criteria: loopCriteriaSchema.partial().optional(),
  })
  .strict();

export interface HttpAppOptions {
  runtime?: EpisodeRuntime;
  publicDirectory?: string;
  fixtureDirectory?: string;
}

/** Retains the single-episode stream server used by `npm run stream` and its contract tests. */
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
      lastSequence = readLegacyLastSequence(request);
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

    for (const event of runtime.eventsAfter(episodeId, lastSequence))
      writeGameEvent(response, event);
    const unsubscribe = runtime.subscribe(episodeId, (event) => writeGameEvent(response, event));
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

/** Full multi-episode runtime with persisted learning, SSE, and protected MCP composition. */
export function createArenaApp(config: AppConfig, manager = new EpisodeManager(config)) {
  const publicDirectory = resolve(process.cwd(), 'public');
  const fixtureDirectory = resolve(process.cwd(), 'fixtures');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb', strict: true }));

  app.get('/health/live', (_request, response) => {
    response.json({ status: 'ok', service: 'arena', mode: config.DEMO_MODE });
  });

  app.get('/health/ready', (_request, response) => {
    response.json({ status: 'ready', service: 'arena', mode: config.DEMO_MODE });
  });

  app.post('/api/episodes', (request, response, next) => {
    try {
      requireEpisodeStartAuthorization(request, config);
      const input = startRequestSchema.parse(request.body ?? {});
      const snapshot = manager.start(input.id, definedCriteria(input.criteria));
      const encodedId = encodeURIComponent(snapshot.id);
      response.status(202).json({
        ...snapshot,
        episodeId: snapshot.id,
        statusUrl: `/api/episodes/${encodedId}`,
        snapshotUrl: `/api/episodes/${encodedId}`,
        eventsUrl: `/api/episodes/${encodedId}/events`,
        liveUrl: `/?mode=live&episode=${encodedId}`,
        uiUrl: `/?mode=live&episode=${encodedId}`,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/episodes/:id', (request, response) => {
    const snapshot = manager.get(request.params.id);
    const hub = manager.hub(request.params.id);
    if (snapshot === null || hub === null) {
      response.status(404).json({ error: 'episode_not_found' });
      return;
    }
    response.json({ ...snapshot, episodeId: snapshot.id, events: hub.history });
  });

  app.get('/api/episodes/:id/events', (request, response, next) => {
    const hub = manager.hub(request.params.id);
    if (hub === null) {
      response.status(404).json({ error: 'episode_not_found' });
      return;
    }

    let lastSequence: number;
    try {
      lastSequence = readLearningLastSequence(request);
    } catch (error) {
      next(error);
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

    for (const event of hub.since(lastSequence)) writePresentationEvent(response, event);
    const unsubscribe = hub.subscribe((event) => writePresentationEvent(response, event));
    const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 15_000);
    request.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  mountRecruitingMcp(app, config, manager);

  app.use('/fixtures', express.static(fixtureDirectory));
  app.use('/api', (_request, response) => response.status(404).json({ error: 'not_found' }));
  app.use(express.static(publicDirectory, { extensions: ['html'] }));
  app.get('*path', (_request, response) => response.sendFile(`${publicDirectory}/index.html`));

  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    void next;
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: 'invalid_request', issues: error.issues });
      return;
    }
    if (error instanceof LearningEpisodeConflictError) {
      response.status(409).json({ error: 'episode_conflict', message: error.message });
      return;
    }
    if (error instanceof EpisodeStartUnauthorizedError) {
      response.status(401).json({ error: 'episode_start_unauthorized' });
      return;
    }
    if (error instanceof RangeError) {
      response.status(400).json({ error: 'invalid_resume_sequence' });
      return;
    }
    response.status(500).json({ error: 'internal_error' });
  });

  return { app, manager };
}

export function startArenaServer(config: AppConfig) {
  const { app, manager } = createArenaApp(config);
  const server = app.listen(config.PORT, '0.0.0.0', () => {
    process.stdout.write(
      `Hire Me If You Can arena listening on http://127.0.0.1:${config.PORT} (${config.DEMO_MODE})\n`,
    );
  });
  return { server, manager };
}

class EpisodeStartUnauthorizedError extends Error {}

function requireEpisodeStartAuthorization(request: Request, config: AppConfig): void {
  if (config.DEMO_MODE !== 'hybrid' && config.DEMO_MODE !== 'live') return;
  const configuredToken = config.INTERNAL_AGENT_TOKEN;
  const authorization = request.get('Authorization');
  const suppliedToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  if (
    configuredToken === undefined ||
    suppliedToken === undefined ||
    !constantTimeEqual(suppliedToken, configuredToken)
  ) {
    throw new EpisodeStartUnauthorizedError();
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readLegacyLastSequence(request: Request): number {
  const raw = request.get('Last-Event-ID') ?? request.query.lastSequence ?? '0';
  const value = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Last-Event-ID must be a non-negative safe integer.');
  }
  return value;
}

function readLearningLastSequence(request: Request): number {
  const raw = request.get('Last-Event-ID') ?? request.query.lastSequence ?? '0';
  const value = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Last-Event-ID must be a non-negative safe integer.');
  }
  return value;
}

function writeGameEvent(response: Response, event: GameEvent): void {
  response.write(`id: ${event.sequence}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writePresentationEvent(response: Response, event: PresentationEvent): void {
  response.write(`id: ${event.sequence}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function sendRuntimeError(response: Response, error: unknown): void {
  if (error instanceof EpisodeActiveError) {
    response.status(409).json({ error: 'episode_active' });
    return;
  }
  if (error instanceof RuntimeEpisodeConflictError) {
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

function definedCriteria(
  criteria: Partial<Record<keyof LoopCriteria, number | undefined>> | undefined,
): Partial<LoopCriteria> {
  if (criteria === undefined) return {};
  return Object.fromEntries(
    Object.entries(criteria).filter((entry): entry is [string, number] => entry[1] !== undefined),
  );
}
