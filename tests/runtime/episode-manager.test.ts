import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { CalendarSchedulePort } from '../../src/adapters/calendar/index.js';
import { readConfig } from '../../src/config.js';
import { EpisodeManager } from '../../src/runtime/episode-manager.js';

describe('EpisodeManager adapter composition', () => {
  it('fails the live Zero preflight before any outbound episode event can run', async () => {
    const memoryDirectory = await mkdtemp(join(tmpdir(), 'episode-manager-preflight-'));
    const config = readConfig({
      SERVICE_ROLE: 'arena',
      DEMO_MODE: 'live',
      DEMO_STEP_DELAY_MS: '0',
      LOOP_MEMORY_DIRECTORY: memoryDirectory,
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
      ZERO_MODE: 'live',
      ZERO_RUNNER: '/definitely/missing/zero-cli',
      ZERO_ALLOWED_CAPABILITY_REFS: 'public-page.capture.v1',
      ZERO_ALLOWED_TARGET_DOMAINS: 'portfolio.example.com',
      ZERO_TARGET_BASE_URL: 'https://portfolio.example.com/claims/',
      RECRUITING_OPS_MODE: 'http',
      OUTBOUND_RECRUITING_BASE_URL: 'https://ats-sandbox.example.com/',
      OUTBOUND_RECRUITING_BEARER_TOKEN: 'outbound-token-at-least-24-characters',
      CALENDAR_MODE: 'google',
      GOOGLE_CALENDAR_OAUTH_ACCESS_TOKEN: 'calendar-token-at-least-24-characters',
      GOOGLE_CALENDAR_SANDBOX_ID: 'team-sandbox@example.com',
      SANDBOX_CALENDAR_ATTENDEE_EMAIL: 'controlled-candidate@example.com',
      SANDBOX_SCREEN_START_AT: '2026-07-18T18:00:00Z',
      SANDBOX_SCREEN_END_AT: '2026-07-18T18:30:00Z',
    });
    const manager = new EpisodeManager(config, {
      calendar: { scheduleScreen: vi.fn() },
    });
    const run = manager.start('zero-preflight-test');

    await expect(manager.wait(run.id)).rejects.toThrow(
      'live Zero preflight failed closed before outbound side effects',
    );
    expect(manager.hub(run.id)?.history.map((event) => event.kind)).not.toContain('role_created');
    expect(manager.hub(run.id)?.history.map((event) => event.kind)).not.toContain('outreach_sent');
  });

  it('routes an evidence-bound protected schedule to the configured calendar port', async () => {
    const memoryDirectory = await mkdtemp(join(tmpdir(), 'episode-manager-calendar-'));
    const scheduleScreen = vi.fn<CalendarSchedulePort['scheduleScreen']>().mockResolvedValue({
      operationId: 'calendar-operation-1',
      eventId: 'calendar-event-1',
      idempotentReplay: false,
    });
    const config = readConfig({
      SERVICE_ROLE: 'arena',
      DEMO_MODE: 'fake',
      DEMO_STEP_DELAY_MS: '0',
      LOOP_MEMORY_DIRECTORY: memoryDirectory,
      CALENDAR_MODE: 'google',
      GOOGLE_CALENDAR_OAUTH_ACCESS_TOKEN: 'calendar-token-at-least-24-characters',
      GOOGLE_CALENDAR_SANDBOX_ID: 'team-sandbox@example.com',
      SANDBOX_CALENDAR_ATTENDEE_EMAIL: 'controlled-candidate@example.com',
      SANDBOX_SCREEN_START_AT: '2026-07-18T18:00:00Z',
      SANDBOX_SCREEN_END_AT: '2026-07-18T18:30:00Z',
    });
    const manager = new EpisodeManager(config, { calendar: { scheduleScreen } });
    const run = manager.start('calendar-integration-test');
    await manager.wait(run.id);

    const evidenceEvent = manager
      .hub(run.id)
      ?.history.find((event) => event.kind === 'evidence_submitted');
    expect(evidenceEvent).toBeDefined();
    const episodeId = String(evidenceEvent?.payload.innerEpisodeId);
    const evidenceId = String(evidenceEvent?.payload.evidenceId);

    const result = await manager.executeProtectedSchedule(run.id, {
      episodeId,
      evidenceId,
      candidateId: 'candidate-control',
      roleId: 'role-loop-engineer',
      sandboxCalendarId: 'calendar-sandbox',
    });

    expect(scheduleScreen).toHaveBeenCalledExactlyOnceWith({
      sandboxCalendarId: 'team-sandbox@example.com',
      episodeId,
      evidenceId,
      candidateId: 'candidate-control',
      roleId: 'role-loop-engineer',
      attendeeEmail: 'controlled-candidate@example.com',
      title: '[HACKATHON TEST] Screening',
      description: 'Evidence-backed screening event in the team-controlled sandbox calendar.',
      startAt: '2026-07-18T18:00:00Z',
      endAt: '2026-07-18T18:30:00Z',
    });
    expect(result).toMatchObject({
      operationId: 'calendar-operation-1',
      eventId: 'calendar-event-1',
      idempotentReplay: false,
    });

    const replay = await manager.executeProtectedSchedule(run.id, {
      episodeId,
      evidenceId,
      candidateId: 'candidate-control',
      roleId: 'role-loop-engineer',
      sandboxCalendarId: 'calendar-sandbox',
    });
    expect(replay).toEqual(result);
    expect(scheduleScreen).toHaveBeenCalledTimes(1);
  });
});
