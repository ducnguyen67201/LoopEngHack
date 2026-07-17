import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  arenaEventKindSchema,
  contractFixtureSchema,
  pomeriumIngestionSchema,
  toolInputSchemas,
  toolNameSchema,
} from '../src/domain/schemas.js';
import type {
  ArenaEvent,
  ArenaEventDraft,
  LoginResult,
  LoginScenarioInput,
  TargetHealth,
  TargetVersion,
} from '../src/domain/types.js';
import type { Clock, EventSink, IdGenerator, TargetGateway } from '../src/domain/ports.js';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/contract-events.json', import.meta.url), 'utf8'),
) as unknown;

describe('contract kit', () => {
  it('validates the synthetic event fixture and covers every event kind', () => {
    const parsed = contractFixtureSchema.parse(fixture);
    const representedKinds = new Set(
      [...parsed.events, ...parsed.edgeCaseEvents].map((event) => event.kind),
    );

    expect(parsed.fixtureLabel).toBe('SYNTHETIC CONTRACT FIXTURE');
    expect(parsed.events.map((event) => event.turn)).toEqual(
      expect.arrayContaining([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    );
    expect([...representedKinds].sort()).toEqual([...arenaEventKindSchema.options].sort());
  });

  it('freezes the exact seven-tool surface and rejects arbitrary attack input', () => {
    expect(Object.keys(toolInputSchemas)).toEqual(toolNameSchema.options);
    expect(() =>
      toolInputSchemas.arena_submit_attack.parse({
        episode_id: 'episode-1',
        attempt_id: 'attempt-1',
        scenario: 'run_arbitrary_command',
        replay: false,
        command: 'whoami',
      }),
    ).toThrow();
  });

  it('accepts only the sanitized Pomerium ingestion envelope', () => {
    expect(
      pomeriumIngestionSchema.parse({
        schemaVersion: 1,
        episode_id: 'episode-1',
        attempt_id: 'attempt-1',
        request_id: 'request-1',
        identity: 'white-agent-service-account',
        mcp_method: 'tools/call',
        mcp_tool: 'arena_promote_candidate',
        decision: 'deny',
        reason: 'tool outside White allowlist',
        received_at: '2026-07-17T18:00:00.000Z',
      }).decision,
    ).toBe('deny');

    expect(() =>
      pomeriumIngestionSchema.parse({
        schemaVersion: 1,
        episode_id: 'episode-1',
        attempt_id: 'attempt-1',
        request_id: 'request-1',
        identity: 'white-agent-service-account',
        mcp_method: 'tools/call',
        mcp_tool: 'arena_promote_candidate',
        decision: 'deny',
        reason: 'denied',
        received_at: '2026-07-17T18:00:00.000Z',
        authorization: 'Bearer Pomerium-secret',
      }),
    ).toThrow();
  });

  it('lets downstream lanes compile against fake ports', async () => {
    const target: TargetGateway = {
      health: (version: TargetVersion): Promise<TargetHealth> =>
        Promise.resolve({ status: 'healthy', version }),
      login: (version: TargetVersion, input: LoginScenarioInput): Promise<LoginResult> =>
        Promise.resolve({
          status: input.credentialCase === 'invalid' ? 401 : 200,
          authenticated: input.credentialCase.startsWith('valid_'),
          role: input.credentialCase === 'valid_admin' ? 'admin' : null,
          flagVisible: false,
          responseLabel: `${version} contract fake`,
        }),
    };
    const clock: Clock = {
      now: () => '2026-07-17T18:00:00.000Z',
      sleep: () => Promise.resolve(),
    };
    const ids: IdGenerator = { next: (prefix) => `${prefix}-1` };
    const events: ArenaEvent[] = [];
    const sink: EventSink = {
      append(event: ArenaEventDraft): ArenaEvent {
        const stored: ArenaEvent = {
          ...event,
          id: ids.next('event'),
          sequence: events.length + 1,
          occurredAt: clock.now(),
        };
        events.push(stored);
        return stored;
      },
    };

    expect(await target.health('v2')).toEqual({ status: 'healthy', version: 'v2' });
    expect(
      await target.login('v2', { credentialCase: 'invalid', requestedRole: 'admin' }),
    ).toMatchObject({ status: 401, flagVisible: false });
    expect(
      sink.append({
        schemaVersion: 1,
        episodeId: 'episode-1',
        turn: 0,
        actor: 'arena',
        kind: 'episode_started',
        summary: 'Contract fake started.',
        evidenceSource: 'synthetic-contract-fixture',
        payload: {},
      }).sequence,
    ).toBe(1);
  });
});
