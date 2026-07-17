import type { IdGenerator, PolicyPort } from '../../domain/ports.js';
import { actorToolMap, errorCategorySchema } from '../../domain/schemas.js';
import type {
  ActorId,
  AuthorizationDecision,
  AuthorizeToolCommand,
  ErrorCategory,
  ExecutionContext,
  Observation,
  ToolName,
} from '../../domain/types.js';
import { DeterministicIdGenerator } from './deterministic.js';
import { DeterministicFailureInjector, type FailurePlan } from './failure-injection.js';
import { commandMatchesContext, FakeObservationFactory } from './observation-factory.js';

export const FAKE_POLICY_OPERATIONS = ['authorize'] as const;
export type FakePolicyOperation = (typeof FAKE_POLICY_OPERATIONS)[number];

export interface FakePolicyPortOptions {
  readonly ids?: IdGenerator;
  readonly failures?: FailurePlan<FakePolicyOperation, ErrorCategory>;
}

export class FakePolicyPort implements PolicyPort {
  private readonly ids: IdGenerator;
  private readonly observations: FakeObservationFactory;
  private readonly failures: DeterministicFailureInjector<FakePolicyOperation, ErrorCategory>;

  public constructor(options: FakePolicyPortOptions = {}) {
    this.ids = options.ids ?? new DeterministicIdGenerator();
    this.observations = new FakeObservationFactory(this.ids);
    this.failures = new DeterministicFailureInjector(
      options.failures,
      FAKE_POLICY_OPERATIONS,
      errorCategorySchema.options,
    );
  }

  public authorize(input: AuthorizeToolCommand, context: ExecutionContext): Promise<Observation> {
    if (!commandMatchesContext(input, context) || input.actor !== context.actor) {
      return Promise.resolve(
        this.observations.error(
          context,
          'pomerium-authorize-log',
          'contract_violation',
          'Fake policy rejected an actor or command context mismatch.',
        ),
      );
    }

    const failure = this.failures.take('authorize');
    if (failure !== undefined) {
      return Promise.resolve(
        this.observations.error(
          context,
          'pomerium-authorize-log',
          failure,
          'Fake policy reproduced a configured failure.',
        ),
      );
    }

    const decision = isAllowed(input.actor, input.tool) ? 'allow' : 'deny';
    const requestId = this.ids.next('policy-request');
    const authorization: AuthorizationDecision = {
      identity: machineIdentity(input.actor),
      actor: input.actor,
      tool: input.tool,
      decision,
      reasonCodes: [decision === 'allow' ? 'actor-tool-allowlist' : 'actor-tool-denied'],
      requestId,
      occurredAt: context.occurredAt,
    };

    return Promise.resolve(
      this.observations.result(context, 'pomerium-authorize-log', {
        status: decision === 'allow' ? 'success' : 'warning',
        summary:
          decision === 'allow'
            ? `Fake policy allowed ${input.tool}.`
            : `Fake policy denied ${input.tool}.`,
        facts: [
          { key: 'policy_decision', value: decision, sourceRef: requestId },
          { key: 'requested_tool', value: input.tool, sourceRef: requestId },
        ],
        riskSignals:
          decision === 'deny'
            ? [
                {
                  code: 'unauthorized_tool_request',
                  severity: 'high',
                  summary: 'The authenticated actor is not allowed to execute the requested tool.',
                },
              ]
            : [],
        authorization,
        nextActions: decision === 'deny' ? [] : [input.tool],
      }),
    );
  }
}

function isAllowed(actor: ActorId, tool: ToolName): boolean {
  return (actorToolMap[actor] as readonly ToolName[]).includes(tool);
}

function machineIdentity(actor: ActorId): string {
  return `${actor}-service`;
}
