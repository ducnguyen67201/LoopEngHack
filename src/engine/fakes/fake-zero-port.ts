import { createHash } from 'node:crypto';

import type { IdGenerator, ZeroPort } from '../../domain/ports.js';
import { errorCategorySchema } from '../../domain/schemas.js';
import type {
  DiscoverCapabilityCommand,
  ErrorCategory,
  ExecutionContext,
  InvokeCapabilityCommand,
  Observation,
  VerificationNeed,
} from '../../domain/types.js';
import { DeterministicIdGenerator } from './deterministic.js';
import { DeterministicFailureInjector, type FailurePlan } from './failure-injection.js';
import { commandMatchesContext, FakeObservationFactory } from './observation-factory.js';

export const FAKE_ZERO_OPERATIONS = ['discover', 'invoke'] as const;
export type FakeZeroOperation = (typeof FAKE_ZERO_OPERATIONS)[number];

interface FakeCapability {
  readonly id: string;
  readonly need: VerificationNeed;
  readonly costUsd: number;
}

const ALLOWLISTED_CAPABILITIES: Readonly<Record<VerificationNeed, FakeCapability>> = Object.freeze({
  public_page_capture: Object.freeze({
    id: 'zero-public-page-capture-v1',
    need: 'public_page_capture',
    costUsd: 0.02,
  }),
  public_claim_lookup: Object.freeze({
    id: 'zero-public-claim-lookup-v1',
    need: 'public_claim_lookup',
    costUsd: 0.03,
  }),
});

export interface FakeZeroPortOptions {
  readonly ids?: IdGenerator;
  readonly failures?: FailurePlan<FakeZeroOperation, ErrorCategory>;
  readonly verifiedClaimIds?: readonly string[];
}

export class FakeZeroPort implements ZeroPort {
  private readonly ids: IdGenerator;
  private readonly observations: FakeObservationFactory;
  private readonly failures: DeterministicFailureInjector<FakeZeroOperation, ErrorCategory>;
  private readonly verifiedClaimIds: ReadonlySet<string>;
  private readonly discoveries = new Map<string, ReadonlySet<string>>();

  public constructor(options: FakeZeroPortOptions = {}) {
    this.ids = options.ids ?? new DeterministicIdGenerator();
    this.observations = new FakeObservationFactory(this.ids);
    this.failures = new DeterministicFailureInjector(
      options.failures,
      FAKE_ZERO_OPERATIONS,
      errorCategorySchema.options,
    );
    this.verifiedClaimIds = new Set(options.verifiedClaimIds ?? ['claim-legitimate']);
  }

  public discover(
    input: DiscoverCapabilityCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    const failed = this.before('discover', input, context);
    if (failed !== undefined) return Promise.resolve(failed);

    const capability = ALLOWLISTED_CAPABILITIES[input.need];
    const previouslyDiscovered = this.discoveries.get(input.episodeId) ?? new Set<string>();
    this.discoveries.set(input.episodeId, new Set([...previouslyDiscovered, capability.id]));

    return Promise.resolve(
      this.observations.result(context, 'zero', {
        status: 'success',
        summary: 'Fake Zero discovered an allowlisted verification capability.',
        facts: [
          { key: 'capability_id', value: capability.id, sourceRef: 'fake-zero-discovery' },
          { key: 'verification_need', value: capability.need, sourceRef: 'fake-zero-discovery' },
          { key: 'allowlisted', value: true, sourceRef: 'fake-zero-discovery' },
          { key: 'cost_usd', value: capability.costUsd, sourceRef: 'fake-zero-discovery' },
        ],
        nextActions: ['zero_run_verifier'],
      }),
    );
  }

  public invoke(input: InvokeCapabilityCommand, context: ExecutionContext): Promise<Observation> {
    const failed = this.before('invoke', input, context);
    if (failed !== undefined) return Promise.resolve(failed);

    const capability = ALLOWLISTED_CAPABILITIES[input.need];
    const discovered = this.discoveries.get(input.episodeId);
    if (capability.id !== input.capabilityId || discovered?.has(input.capabilityId) !== true) {
      return Promise.resolve(
        this.observations.error(
          context,
          'zero',
          'capability_unavailable',
          'Fake Zero refused a capability that was not allowlisted and discovered in this episode.',
        ),
      );
    }

    const claimVerified = this.verifiedClaimIds.has(input.claimId);
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          capabilityId: capability.id,
          claimId: input.claimId,
          claimVerified,
          need: input.need,
        }),
      )
      .digest('hex');
    const artifactId = this.ids.next('zero-evidence');

    return Promise.resolve(
      this.observations.result(context, 'zero', {
        status: 'success',
        summary: claimVerified
          ? 'Fake Zero independently verified the public claim.'
          : 'Fake Zero found that the public claim was not independently supported.',
        facts: [
          { key: 'claim_id', value: input.claimId, sourceRef: artifactId },
          { key: 'claim_verified', value: claimVerified, sourceRef: artifactId },
          { key: 'capability_id', value: capability.id, sourceRef: artifactId },
          { key: 'artifact_digest', value: digest, sourceRef: artifactId },
        ],
        riskSignals: claimVerified
          ? []
          : [
              {
                code: 'public_claim_unsupported',
                severity: 'high',
                summary: 'Independent public evidence does not support the candidate claim.',
              },
            ],
        nextActions: ['evidence_submit'],
        artifacts: [
          {
            id: artifactId,
            kind: input.need === 'public_page_capture' ? 'web-capture' : 'evidence',
            digest,
            metadata: {
              capabilityId: capability.id,
              claimId: input.claimId,
              claimVerified,
              mode: 'fake',
            },
          },
        ],
      }),
    );
  }

  private before(
    operation: FakeZeroOperation,
    input: Readonly<{ episodeId: string; attemptId: string }>,
    context: ExecutionContext,
  ): Observation | undefined {
    if (!commandMatchesContext(input, context)) {
      return this.observations.error(
        context,
        'zero',
        'contract_violation',
        'Fake Zero rejected mismatched command context.',
      );
    }

    const failure = this.failures.take(operation);
    return failure === undefined
      ? undefined
      : this.observations.error(
          context,
          'zero',
          failure,
          'Fake Zero reproduced a configured failure.',
        );
  }
}
