import { observationSchema } from '../../domain/schemas.js';
import type {
  ArtifactReference,
  AuthorizationDecision,
  ErrorCategory,
  ExecutionContext,
  Fact,
  Observation,
  Provenance,
  RiskSignal,
  ToolName,
} from '../../domain/types.js';
import type { IdGenerator } from '../../domain/ports.js';

interface ObservationDetails {
  readonly status: 'success' | 'warning';
  readonly summary: string;
  readonly facts?: readonly Fact[];
  readonly riskSignals?: readonly RiskSignal[];
  readonly uncertainties?: readonly string[];
  readonly authorization?: AuthorizationDecision;
  readonly nextActions?: readonly ToolName[];
  readonly artifacts?: readonly ArtifactReference[];
}

const RECOVERY_BY_CATEGORY: Readonly<
  Record<
    ErrorCategory,
    Readonly<{ rootCauseHint: string; safeRetry: string | null; stopCondition: string }>
  >
> = {
  authorization_denied: {
    rootCauseHint: 'The machine identity is not permitted to execute this tool.',
    safeRetry: 'Retry only through an identity whose fixed policy allows the same tool.',
    stopCondition: 'Stop if the permitted identity is unavailable.',
  },
  capability_unavailable: {
    rootCauseHint: 'No allowlisted capability is available for the bounded verification need.',
    safeRetry: 'Retry discovery once with the same bounded need.',
    stopCondition: 'Stop after a repeated capability lookup failure.',
  },
  invalid_evidence: {
    rootCauseHint: 'The referenced evidence does not satisfy the scheduling contract.',
    safeRetry: null,
    stopCondition: 'Stop until complete evidence is produced and validated server-side.',
  },
  upstream_failure: {
    rootCauseHint: 'The configured fake reproduced a sanitized upstream failure.',
    safeRetry: 'Retry this operation once with the same bounded input.',
    stopCondition: 'Stop after the same upstream failure is observed twice.',
  },
  budget_exceeded: {
    rootCauseHint: 'The verification cost ceiling has been reached.',
    safeRetry: null,
    stopCondition: 'Stop before invoking a capability or scheduling a screen.',
  },
  contract_violation: {
    rootCauseHint: 'The command conflicts with the strict fake-port contract.',
    safeRetry: null,
    stopCondition: 'Stop and correct the command or execution context.',
  },
};

export class FakeObservationFactory {
  public constructor(private readonly ids: IdGenerator) {}

  public result(
    context: ExecutionContext,
    provenance: Provenance,
    details: ObservationDetails,
  ): Observation {
    return observationSchema.parse({
      schemaVersion: 1,
      id: this.ids.next('observation'),
      episodeId: context.episodeId,
      attemptId: context.attemptId,
      turn: context.turn,
      actor: context.actor,
      phase: context.phase,
      status: details.status,
      summary: details.summary,
      facts: details.facts ?? [],
      riskSignals: details.riskSignals ?? [],
      uncertainties: details.uncertainties ?? [],
      ...(details.authorization === undefined ? {} : { authorization: details.authorization }),
      nextActions: details.nextActions ?? [],
      artifacts: details.artifacts ?? [],
      provenance,
      occurredAt: context.occurredAt,
    });
  }

  public error(
    context: ExecutionContext,
    provenance: Provenance,
    category: ErrorCategory,
    summary: string,
  ): Observation {
    return observationSchema.parse({
      schemaVersion: 1,
      id: this.ids.next('observation'),
      episodeId: context.episodeId,
      attemptId: context.attemptId,
      turn: context.turn,
      actor: context.actor,
      phase: context.phase,
      status: 'error',
      errorCategory: category,
      summary,
      facts: [],
      riskSignals: [],
      uncertainties: [],
      nextActions: [],
      artifacts: [],
      recovery: RECOVERY_BY_CATEGORY[category],
      provenance,
      occurredAt: context.occurredAt,
    });
  }
}

export function commandMatchesContext(
  command: Readonly<{ episodeId: string; attemptId: string }>,
  context: ExecutionContext,
): boolean {
  return command.episodeId === context.episodeId && command.attemptId === context.attemptId;
}
