import { randomUUID } from 'node:crypto';

import type { ZeroPort } from '../../domain/ports.js';
import { observationSchema } from '../../domain/schemas.js';
import type {
  DiscoverCapabilityCommand,
  ErrorCategory,
  ExecutionContext,
  InvokeCapabilityCommand,
  Observation,
} from '../../domain/types.js';
import { hashArtifact } from './evidence.js';
import { ZeroAdapterError, type VerificationTarget, type ZeroBudget } from './types.js';
import type { ZeroVerificationAdapter } from './zero-verification-adapter.js';

export interface ClaimTarget {
  readonly target: VerificationTarget;
  readonly allowedDomains: readonly string[];
}

export interface ClaimTargetResolver {
  resolve(claimId: string): Promise<ClaimTarget>;
}

export interface ZeroPortAdapterOptions {
  verificationAdapter: ZeroVerificationAdapter;
  claimTargetResolver: ClaimTargetResolver;
  budget: ZeroBudget;
}

interface EpisodeDiscovery {
  discoveryId: string;
  capabilityId: string;
  need: DiscoverCapabilityCommand['need'];
}

/** Maps Zero's transport model to the engine's strict, provenance-bearing port. */
export class ZeroPortAdapter implements ZeroPort {
  private readonly verificationAdapter: ZeroVerificationAdapter;
  private readonly claimTargetResolver: ClaimTargetResolver;
  private readonly budget: ZeroBudget;
  private readonly latestDiscoveryByEpisode = new Map<string, EpisodeDiscovery>();

  public constructor(options: ZeroPortAdapterOptions) {
    this.verificationAdapter = options.verificationAdapter;
    this.claimTargetResolver = options.claimTargetResolver;
    this.budget = { ...options.budget };
  }

  public async discover(
    input: DiscoverCapabilityCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    const contractError = this.validateContext(input, context, 'zero_discover_verifier');
    if (contractError !== null) return contractError;

    // A new search invalidates the prior selection even when Zero is down.
    this.latestDiscoveryByEpisode.delete(input.episodeId);

    try {
      const discovery = await this.verificationAdapter.discover({
        episodeId: input.episodeId,
        attemptId: input.attemptId,
        need: input.need,
        target: {},
        allowedDomains: [],
        budget: this.budget,
        now: context.occurredAt,
      });
      if (discovery.selected === null) {
        return this.error(
          context,
          'capability_unavailable',
          'Zero did not return an allowlisted verification capability.',
          ['zero_discover_verifier'],
        );
      }

      this.latestDiscoveryByEpisode.set(input.episodeId, {
        discoveryId: discovery.discoveryId,
        capabilityId: discovery.selected.ref,
        need: input.need,
      });
      const artifact = hashArtifact({
        discoveryId: discovery.discoveryId,
        capabilityId: discovery.selected.ref,
        query: discovery.query,
      });

      return this.success(context, {
        summary: 'Zero discovered an allowlisted verification capability.',
        facts: [
          {
            key: 'capability_id',
            value: discovery.selected.ref,
            sourceRef: discovery.discoveryId,
          },
          {
            key: 'verification_need',
            value: discovery.need,
            sourceRef: discovery.discoveryId,
          },
          { key: 'allowlisted', value: true, sourceRef: discovery.discoveryId },
          {
            key: 'cost_usd',
            value: discovery.selected.declaredCostMicroUsd / 1_000_000,
            sourceRef: discovery.discoveryId,
          },
        ],
        nextActions: ['zero_run_verifier'],
        artifacts: [
          {
            id: discovery.discoveryId,
            kind: 'evidence',
            digest: artifact.sha256,
            metadata: {
              capabilityId: discovery.selected.ref,
              mode: discovery.mode,
            },
          },
        ],
      });
    } catch (error) {
      return this.fromError(context, error, ['zero_discover_verifier']);
    }
  }

  public async invoke(
    input: InvokeCapabilityCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    const contractError = this.validateContext(input, context, 'zero_run_verifier');
    if (contractError !== null) return contractError;

    const discovery = this.latestDiscoveryByEpisode.get(input.episodeId);
    if (
      discovery === undefined ||
      discovery.capabilityId !== input.capabilityId ||
      discovery.need !== input.need
    ) {
      return this.error(
        context,
        'capability_unavailable',
        'The capability was not selected by the current episode discovery.',
        ['zero_discover_verifier'],
      );
    }

    let resolved: ClaimTarget;
    try {
      resolved = await this.claimTargetResolver.resolve(input.claimId);
    } catch {
      return this.error(
        context,
        'invalid_evidence',
        'Zero could not resolve the claim to a server-approved public target.',
        [],
      );
    }

    try {
      const invocation = await this.verificationAdapter.invoke({
        episodeId: input.episodeId,
        attemptId: input.attemptId,
        discoveryId: discovery.discoveryId,
        capabilityRef: input.capabilityId,
        need: input.need,
        target: resolved.target,
        allowedDomains: resolved.allowedDomains,
        budget: this.budget,
        now: context.occurredAt,
      });

      if (invocation.status === 'error') {
        return this.error(context, 'upstream_failure', invocation.summary, [
          'zero_discover_verifier',
        ]);
      }

      return this.success(context, {
        status: invocation.status,
        summary: invocation.summary,
        facts: [
          {
            key: 'claim_id',
            value: input.claimId,
            sourceRef: invocation.artifact.id,
          },
          {
            key: 'capability_id',
            value: invocation.capabilityRef,
            sourceRef: invocation.artifact.id,
          },
          {
            key: 'artifact_digest',
            value: invocation.artifact.sha256,
            sourceRef: invocation.artifact.id,
          },
          ...invocation.facts.map((fact) => ({
            key: fact.key,
            value: fact.value,
            sourceRef: invocation.artifact.id,
          })),
        ],
        riskSignals: invocation.riskSignals.map((signal) => ({
          code: signal.key,
          severity: 'medium' as const,
          summary: signal.detail,
        })),
        uncertainties: invocation.uncertainties,
        nextActions: invocation.status === 'success' ? ['evidence_submit'] : ['zero_run_verifier'],
        artifacts: [
          {
            id: invocation.artifact.id,
            kind: input.need === 'public_page_capture' ? 'web-capture' : 'evidence',
            digest: invocation.artifact.sha256,
            metadata: {
              capabilityId: invocation.capabilityRef,
              invocationId: invocation.invocationId,
              runId: invocation.provider.runId,
              mode: invocation.mode,
            },
          },
        ],
      });
    } catch (error) {
      return this.fromError(context, error, ['zero_discover_verifier']);
    }
  }

  private validateContext(
    input: Readonly<{ episodeId: string; attemptId: string; tool: string }>,
    context: ExecutionContext,
    expectedTool: 'zero_discover_verifier' | 'zero_run_verifier',
  ): Observation | null {
    if (
      context.actor !== 'white-verifier' ||
      input.episodeId !== context.episodeId ||
      input.attemptId !== context.attemptId ||
      input.tool !== expectedTool
    ) {
      return this.error(
        context,
        'contract_violation',
        'Zero rejected an actor, tool, or execution-context mismatch.',
        [],
      );
    }
    return null;
  }

  private success(
    context: ExecutionContext,
    details: Pick<Observation, 'summary' | 'facts' | 'nextActions' | 'artifacts'> &
      Partial<Pick<Observation, 'status' | 'riskSignals' | 'uncertainties'>>,
  ): Observation {
    return observationSchema.parse({
      schemaVersion: 1,
      id: `observation-${randomUUID()}`,
      episodeId: context.episodeId,
      attemptId: context.attemptId,
      turn: context.turn,
      actor: context.actor,
      phase: context.phase,
      status: details.status ?? 'success',
      summary: details.summary,
      facts: details.facts,
      riskSignals: details.riskSignals ?? [],
      uncertainties: details.uncertainties ?? [],
      nextActions: details.nextActions,
      artifacts: details.artifacts,
      provenance: 'zero',
      occurredAt: context.occurredAt,
    });
  }

  private error(
    context: ExecutionContext,
    category: ErrorCategory,
    summary: string,
    nextActions: Observation['nextActions'],
  ): Observation {
    return observationSchema.parse({
      schemaVersion: 1,
      id: `observation-${randomUUID()}`,
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
      nextActions,
      artifacts: [],
      recovery: recoveryFor(category),
      provenance: 'zero',
      occurredAt: context.occurredAt,
    });
  }

  private fromError(
    context: ExecutionContext,
    error: unknown,
    nextActions: Observation['nextActions'],
  ): Observation {
    if (error instanceof ZeroAdapterError) {
      return this.error(
        context,
        mapErrorCategory(error.code),
        safeErrorSummary(error.code),
        nextActions,
      );
    }
    return this.error(context, 'upstream_failure', 'Zero was unavailable.', nextActions);
  }
}

function mapErrorCategory(code: ZeroAdapterError['code']): ErrorCategory {
  switch (code) {
    case 'budget_exceeded':
      return 'budget_exceeded';
    case 'invalid_target':
      return 'invalid_evidence';
    case 'contract_violation':
      return 'contract_violation';
    case 'capability_unavailable':
    case 'capability_not_discovered':
      return 'capability_unavailable';
    case 'transport_failed':
      return 'upstream_failure';
  }
}

function safeErrorSummary(code: ZeroAdapterError['code']): string {
  return code === 'budget_exceeded'
    ? 'The Zero verification budget was exceeded.'
    : code === 'transport_failed'
      ? 'Zero was unavailable.'
      : 'Zero could not satisfy the bounded verification request.';
}

function recoveryFor(category: ErrorCategory) {
  const retryable = category === 'capability_unavailable' || category === 'upstream_failure';
  return {
    rootCauseHint: `Zero returned ${category}.`,
    safeRetry: retryable ? 'Retry bounded discovery once.' : null,
    stopCondition: retryable ? 'Stop after the second identical failure.' : 'Stop this action.',
  };
}
