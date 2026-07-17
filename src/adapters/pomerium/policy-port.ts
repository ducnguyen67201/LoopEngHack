import type { IdGenerator, PolicyPort } from '../../domain/ports.js';
import { observationSchema } from '../../domain/schemas.js';
import type {
  ActorId,
  AuthorizeToolCommand,
  ExecutionContext,
  Observation,
} from '../../domain/types.js';
import type { PomeriumMcpClient } from './mcp-client.js';

type PomeriumToolClient = Pick<PomeriumMcpClient, 'callTool'>;

export interface PomeriumPolicyPortOptions {
  readonly runId: string;
  readonly ids: IdGenerator;
  readonly clients: Readonly<
    Partial<Record<Extract<ActorId, 'outbound-sourcer' | 'hiring-controller'>, PomeriumToolClient>>
  >;
}

export class PomeriumPolicyPort implements PolicyPort {
  constructor(private readonly options: PomeriumPolicyPortOptions) {}

  async authorize(input: AuthorizeToolCommand, context: ExecutionContext): Promise<Observation> {
    const client =
      input.actor === 'outbound-sourcer' || input.actor === 'hiring-controller'
        ? this.options.clients[input.actor]
        : undefined;
    if (client === undefined) {
      return this.error(context, 'No Pomerium route is configured for this actor.');
    }
    const outcome = await client.callTool(input.tool, {
      run_id: this.options.runId,
      episode_id: input.episodeId,
      commit: false,
    });
    if (outcome.status === 'error') return this.error(context, outcome.summary);
    if (outcome.status === 'denied' && outcome.kind !== 'tool_denied') {
      return this.error(
        context,
        'The route denied the request without authoritative MCP tool-policy proof.',
      );
    }
    const decision = outcome.status === 'denied' ? 'deny' : 'allow';
    const identity = `${input.actor}-service`;
    return observationSchema.parse({
      schemaVersion: 1,
      id: this.options.ids.next('pomerium-observation'),
      episodeId: context.episodeId,
      attemptId: context.attemptId,
      turn: context.turn,
      actor: context.actor,
      phase: context.phase,
      status: decision === 'allow' ? 'success' : 'warning',
      summary:
        decision === 'allow'
          ? `Pomerium allowed ${input.tool} for ${input.actor}.`
          : `Pomerium denied ${input.tool} for ${input.actor}.`,
      facts: [
        { key: 'policy_decision', value: decision, sourceRef: outcome.requestId ?? identity },
        { key: 'requested_tool', value: input.tool, sourceRef: outcome.requestId ?? identity },
      ],
      riskSignals:
        decision === 'deny'
          ? [
              {
                code: 'unauthorized_tool_request',
                severity: 'high',
                summary: 'Pomerium denied the authenticated machine identity.',
              },
            ]
          : [],
      uncertainties: [],
      authorization: {
        identity,
        actor: input.actor,
        tool: input.tool,
        decision,
        reasonCodes: [decision === 'allow' ? 'pomerium-route-allowed' : 'pomerium-tool-denied'],
        ...(outcome.requestId === undefined ? {} : { requestId: outcome.requestId }),
        occurredAt: context.occurredAt,
      },
      nextActions: decision === 'allow' ? [input.tool] : [],
      artifacts: [],
      provenance: 'pomerium-authorize-log',
      occurredAt: context.occurredAt,
    });
  }

  private error(context: ExecutionContext, summary: string): Observation {
    return observationSchema.parse({
      schemaVersion: 1,
      id: this.options.ids.next('pomerium-observation'),
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
      uncertainties: ['The protected MCP route did not produce authoritative policy evidence.'],
      nextActions: [],
      artifacts: [],
      recovery: {
        rootCauseHint: 'The Pomerium route, identity, or upstream MCP server is unavailable.',
        safeRetry: 'Retry once after checking Pomerium readiness.',
        stopCondition: 'Stop after a repeated route failure or missing authorization evidence.',
      },
      provenance: 'pomerium-authorize-log',
      occurredAt: context.occurredAt,
    });
  }
}
