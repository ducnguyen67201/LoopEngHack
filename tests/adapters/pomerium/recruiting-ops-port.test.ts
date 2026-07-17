import { describe, expect, it, vi } from 'vitest';

import { PomeriumRecruitingOpsPort } from '../../../src/adapters/pomerium/recruiting-ops-port.js';
import type { RecruitingOpsPort } from '../../../src/domain/ports.js';
import { observationSchema } from '../../../src/domain/schemas.js';
import type {
  ExecutionContext,
  Observation,
  ScheduleScreenCommand,
} from '../../../src/domain/types.js';
import { NamespacedIdGenerator } from '../../../src/runtime/primitives.js';

const context: ExecutionContext = {
  episodeId: 'episode-1',
  attemptId: 'attempt-schedule',
  turn: 7,
  actor: 'hiring-controller',
  phase: 'execute',
  occurredAt: '2026-07-17T20:00:00.000Z',
};

const scheduleCommand: ScheduleScreenCommand = {
  episodeId: 'episode-1',
  attemptId: 'attempt-schedule',
  tool: 'recruiting_schedule_screen',
  candidateId: 'candidate-1',
  roleId: 'role-1',
  evidenceId: 'evidence-1',
  sandboxCalendarId: 'calendar-sandbox-1',
};

describe('PomeriumRecruitingOpsPort', () => {
  it('delegates non-consequential recruiting operations to the base port unchanged', async () => {
    const delegated = baseObservation('delegated-observation');
    const base = recordingBase(delegated);
    const port = createPort(base.port, vi.fn());
    const createRole = {
      episodeId: 'episode-1',
      attemptId: 'attempt-create',
      tool: 'recruiting_create_test_role' as const,
      role: {
        id: 'role-1',
        sandboxId: 'sandbox-1',
        title: 'Platform Engineer',
        testCalendarId: 'calendar-sandbox-1',
      },
    };
    const sourceCandidates = {
      episodeId: 'episode-1',
      attemptId: 'attempt-source',
      tool: 'recruiting_source_test_candidates' as const,
      roleId: 'role-1',
      candidates: [
        {
          id: 'candidate-1',
          label: 'Candidate One',
          kind: 'legitimate' as const,
          roleId: 'role-1',
        },
      ],
    };
    const sendOutreach = {
      episodeId: 'episode-1',
      attemptId: 'attempt-outreach',
      tool: 'recruiting_send_test_outreach' as const,
      roleId: 'role-1',
      candidateId: 'candidate-1',
      templateId: 'template-1',
    };
    const readCandidateEvent = {
      episodeId: 'episode-1',
      attemptId: 'attempt-read',
      tool: 'recruiting_read_pipeline_event' as const,
      candidateId: 'candidate-1',
      eventId: 'event-1',
    };

    await expect(port.createRole(createRole, context)).resolves.toBe(delegated);
    await expect(port.sourceCandidates(sourceCandidates, context)).resolves.toBe(delegated);
    await expect(port.sendOutreach(sendOutreach, context)).resolves.toBe(delegated);
    await expect(port.readCandidateEvent(readCandidateEvent, context)).resolves.toBe(delegated);

    expect(base.calls.createRole).toHaveBeenCalledExactlyOnceWith(createRole, context);
    expect(base.calls.sourceCandidates).toHaveBeenCalledExactlyOnceWith(sourceCandidates, context);
    expect(base.calls.sendOutreach).toHaveBeenCalledExactlyOnceWith(sendOutreach, context);
    expect(base.calls.readCandidateEvent).toHaveBeenCalledExactlyOnceWith(
      readCandidateEvent,
      context,
    );
  });

  it('commits the exact protected scheduling payload and returns correlated calendar evidence', async () => {
    const callTool = vi.fn(() =>
      Promise.resolve({
        status: 'success' as const,
        requestId: 'pomerium-request-1',
        result: {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ operationId: 'calendar-operation-1' }),
            },
          ],
        },
      }),
    );
    const port = createPort(recordingBase(baseObservation('unused-observation')).port, callTool);

    const observation = await port.scheduleScreen(scheduleCommand, context);

    expect(callTool).toHaveBeenCalledExactlyOnceWith('recruiting_schedule_screen', {
      run_id: 'run-1',
      episode_id: 'episode-1',
      evidence_id: 'evidence-1',
      candidate_id: 'candidate-1',
      role_id: 'role-1',
      sandbox_calendar_id: 'calendar-sandbox-1',
      commit: true,
    });
    expect(observationSchema.parse(observation)).toMatchObject({
      status: 'success',
      provenance: 'recruiting-pipeline',
      facts: [
        {
          key: 'calendar_event_id',
          value: 'calendar-operation-1',
          sourceRef: 'pomerium-request-1',
        },
        {
          key: 'candidate_id',
          value: 'candidate-1',
          sourceRef: 'calendar-operation-1',
        },
        {
          key: 'idempotent_replay',
          value: false,
          sourceRef: 'calendar-operation-1',
        },
      ],
      artifacts: [
        {
          id: 'calendar-operation-1',
          kind: 'calendar',
          metadata: {
            candidateId: 'candidate-1',
            roleId: 'role-1',
            evidenceId: 'evidence-1',
            sandboxCalendarId: 'calendar-sandbox-1',
            mode: 'hybrid',
          },
        },
      ],
    });
  });

  it.each([
    {
      status: 'denied' as const,
      kind: 'tool_denied' as const,
      summary: 'Pomerium denied the MCP tool request',
      retriable: false,
    },
    {
      status: 'error' as const,
      kind: 'upstream_failure' as const,
      summary: 'The Pomerium MCP route was unavailable',
      retriable: true,
    },
  ])('stops safely when the protected call returns $status', async (outcome) => {
    const port = createPort(
      recordingBase(baseObservation('unused-observation')).port,
      vi.fn(() => Promise.resolve(outcome)),
    );

    const observation = await port.scheduleScreen(scheduleCommand, context);

    expect(observationSchema.parse(observation)).toMatchObject({
      status: 'error',
      errorCategory: 'upstream_failure',
      summary: outcome.summary,
      uncertainties: ['The protected scheduling outcome is unknown.'],
      recovery: {
        safeRetry: null,
        stopCondition: 'Stop because a consequential tool has an uncertain outcome.',
      },
    });
  });

  it('converts a malformed successful MCP result into a safe terminal observation', async () => {
    const port = createPort(
      recordingBase(baseObservation('unused-observation')).port,
      vi.fn(() =>
        Promise.resolve({
          status: 'success' as const,
          result: { content: [{ type: 'text' as const, text: '{not-json' }] },
        }),
      ),
    );

    const observation = await port.scheduleScreen(scheduleCommand, context);

    expect(observationSchema.parse(observation)).toMatchObject({
      status: 'error',
      errorCategory: 'upstream_failure',
      summary: 'The protected scheduling tool returned an invalid result.',
      uncertainties: ['The protected scheduling outcome is unknown.'],
      recovery: { safeRetry: null },
    });
    expect(JSON.stringify(observation)).not.toContain('{not-json');
  });
});

function createPort(
  base: RecruitingOpsPort,
  callTool: PomeriumRecruitingOpsPortConstructorClient['callTool'],
): PomeriumRecruitingOpsPort {
  return new PomeriumRecruitingOpsPort({
    runId: 'run-1',
    ids: new NamespacedIdGenerator('pomerium-recruiting-test'),
    base,
    controllerClient: { callTool },
  });
}

type PomeriumRecruitingOpsPortConstructorClient = ConstructorParameters<
  typeof PomeriumRecruitingOpsPort
>[0]['controllerClient'];

function recordingBase(observation: Observation) {
  const calls = {
    createRole: vi.fn<RecruitingOpsPort['createRole']>(() => Promise.resolve(observation)),
    sourceCandidates: vi.fn<RecruitingOpsPort['sourceCandidates']>(() =>
      Promise.resolve(observation),
    ),
    sendOutreach: vi.fn<RecruitingOpsPort['sendOutreach']>(() => Promise.resolve(observation)),
    readCandidateEvent: vi.fn<RecruitingOpsPort['readCandidateEvent']>(() =>
      Promise.resolve(observation),
    ),
    scheduleScreen: vi.fn<RecruitingOpsPort['scheduleScreen']>(() => Promise.resolve(observation)),
  };
  const port: RecruitingOpsPort = { ...calls };
  return { calls, port };
}

function baseObservation(id: string): Observation {
  return observationSchema.parse({
    schemaVersion: 1,
    id,
    episodeId: context.episodeId,
    attemptId: context.attemptId,
    turn: context.turn,
    actor: context.actor,
    phase: context.phase,
    status: 'success',
    summary: 'Base recruiting operation completed.',
    facts: [],
    riskSignals: [],
    uncertainties: [],
    nextActions: [],
    artifacts: [],
    provenance: 'recruiting-pipeline',
    occurredAt: context.occurredAt,
  });
}
