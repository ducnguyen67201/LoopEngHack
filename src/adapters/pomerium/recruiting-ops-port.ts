import type { IdGenerator, RecruitingOpsPort } from '../../domain/ports.js';
import { observationSchema } from '../../domain/schemas.js';
import type {
  CreateRoleCommand,
  ExecutionContext,
  Observation,
  ReadCandidateEventCommand,
  ScheduleScreenCommand,
  SendOutreachCommand,
  SourceCandidatesCommand,
} from '../../domain/types.js';
import type { PomeriumMcpClient } from './mcp-client.js';

type PomeriumToolClient = Pick<PomeriumMcpClient, 'callTool'>;

export interface PomeriumRecruitingOpsPortOptions {
  readonly runId: string;
  readonly ids: IdGenerator;
  readonly base: RecruitingOpsPort;
  readonly controllerClient: PomeriumToolClient;
}

export class PomeriumRecruitingOpsPort implements RecruitingOpsPort {
  constructor(private readonly options: PomeriumRecruitingOpsPortOptions) {}

  createRole(input: CreateRoleCommand, context: ExecutionContext): Promise<Observation> {
    return this.options.base.createRole(input, context);
  }

  sourceCandidates(
    input: SourceCandidatesCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    return this.options.base.sourceCandidates(input, context);
  }

  sendOutreach(input: SendOutreachCommand, context: ExecutionContext): Promise<Observation> {
    return this.options.base.sendOutreach(input, context);
  }

  readCandidateEvent(
    input: ReadCandidateEventCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    return this.options.base.readCandidateEvent(input, context);
  }

  async scheduleScreen(
    input: ScheduleScreenCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    const outcome = await this.options.controllerClient.callTool(input.tool, {
      run_id: this.options.runId,
      episode_id: input.episodeId,
      evidence_id: input.evidenceId,
      candidate_id: input.candidateId,
      role_id: input.roleId,
      sandbox_calendar_id: input.sandboxCalendarId,
      commit: true,
    });
    if (outcome.status !== 'success') {
      return this.error(context, outcome.summary);
    }
    let result: { operationId: string; eventId?: string; idempotentReplay: boolean };
    try {
      result = parseToolResult(outcome.result.content);
    } catch {
      return this.error(context, 'The protected scheduling tool returned an invalid result.');
    }
    return observationSchema.parse({
      schemaVersion: 1,
      id: this.options.ids.next('protected-schedule-observation'),
      episodeId: context.episodeId,
      attemptId: context.attemptId,
      turn: context.turn,
      actor: context.actor,
      phase: context.phase,
      status: 'success',
      summary: 'Pomerium allowed the Controller and the protected sandbox screen was scheduled.',
      facts: [
        {
          key: 'calendar_event_id',
          value: result.eventId ?? result.operationId,
          sourceRef: outcome.requestId ?? result.operationId,
        },
        { key: 'candidate_id', value: input.candidateId, sourceRef: result.operationId },
        {
          key: 'idempotent_replay',
          value: result.idempotentReplay,
          sourceRef: result.operationId,
        },
      ],
      riskSignals: [],
      uncertainties: [],
      nextActions: ['episode_complete'],
      artifacts: [
        {
          id: result.operationId,
          kind: 'calendar',
          metadata: {
            candidateId: input.candidateId,
            roleId: input.roleId,
            evidenceId: input.evidenceId,
            sandboxCalendarId: input.sandboxCalendarId,
            mode: 'hybrid',
          },
        },
      ],
      provenance: 'recruiting-pipeline',
      occurredAt: context.occurredAt,
    });
  }

  private error(context: ExecutionContext, summary: string): Observation {
    return observationSchema.parse({
      schemaVersion: 1,
      id: this.options.ids.next('protected-schedule-observation'),
      episodeId: context.episodeId,
      attemptId: context.attemptId,
      turn: context.turn,
      actor: context.actor,
      phase: context.phase,
      status: 'error',
      errorCategory: 'upstream_failure',
      summary,
      facts: [],
      riskSignals: [],
      uncertainties: ['The protected scheduling outcome is unknown.'],
      nextActions: [],
      artifacts: [],
      recovery: {
        rootCauseHint: 'The Controller Pomerium route or upstream MCP handler failed.',
        safeRetry: null,
        stopCondition: 'Stop because a consequential tool has an uncertain outcome.',
      },
      provenance: 'recruiting-pipeline',
      occurredAt: context.occurredAt,
    });
  }
}

function parseToolResult(content: readonly unknown[]): {
  operationId: string;
  eventId?: string;
  idempotentReplay: boolean;
} {
  for (const item of content) {
    if (
      typeof item === 'object' &&
      item !== null &&
      'type' in item &&
      item.type === 'text' &&
      'text' in item &&
      typeof item.text === 'string'
    ) {
      try {
        const parsed = JSON.parse(item.text) as {
          operationId?: unknown;
          eventId?: unknown;
          idempotentReplay?: unknown;
        };
        if (
          typeof parsed.operationId === 'string' &&
          /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(parsed.operationId)
        ) {
          const eventId =
            typeof parsed.eventId === 'string' &&
            /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(parsed.eventId)
              ? parsed.eventId
              : undefined;
          return {
            operationId: parsed.operationId,
            ...(eventId === undefined ? {} : { eventId }),
            idempotentReplay:
              typeof parsed.idempotentReplay === 'boolean' ? parsed.idempotentReplay : false,
          };
        }
      } catch {
        // Ignore non-JSON text blocks; MCP results may contain multiple content items.
      }
    }
  }
  throw new Error('Protected scheduling tool returned no operation id');
}
