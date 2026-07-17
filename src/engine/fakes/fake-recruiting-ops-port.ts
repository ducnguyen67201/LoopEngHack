import type { RecruitingOpsPort, IdGenerator } from '../../domain/ports.js';
import { errorCategorySchema } from '../../domain/schemas.js';
import type {
  CreateRoleCommand,
  ErrorCategory,
  ExecutionContext,
  Observation,
  ReadCandidateEventCommand,
  ScheduleScreenCommand,
  SendOutreachCommand,
  SourceCandidatesCommand,
  SyntheticCandidate,
  SyntheticRoleBrief,
} from '../../domain/types.js';
import { DeterministicIdGenerator } from './deterministic.js';
import { DeterministicFailureInjector, type FailurePlan } from './failure-injection.js';
import { commandMatchesContext, FakeObservationFactory } from './observation-factory.js';

export const FAKE_RECRUITING_OPS_OPERATIONS = [
  'createRole',
  'sourceCandidates',
  'sendOutreach',
  'readCandidateEvent',
  'scheduleScreen',
] as const;

export type FakeRecruitingOpsOperation = (typeof FAKE_RECRUITING_OPS_OPERATIONS)[number];

export interface FakeRecruitingOpsPortOptions {
  readonly ids?: IdGenerator;
  readonly failures?: FailurePlan<FakeRecruitingOpsOperation, ErrorCategory>;
}

interface ScheduledScreen {
  readonly episodeId: string;
  readonly candidateId: string;
  readonly roleId: string;
  readonly evidenceId: string;
  readonly sandboxCalendarId: string;
  readonly calendarEventId: string;
}

export class FakeRecruitingOpsPort implements RecruitingOpsPort {
  private readonly ids: IdGenerator;
  private readonly observations: FakeObservationFactory;
  private readonly failures: DeterministicFailureInjector<
    FakeRecruitingOpsOperation,
    ErrorCategory
  >;
  private readonly roles = new Map<string, SyntheticRoleBrief>();
  private readonly candidates = new Map<string, SyntheticCandidate>();
  private readonly contactedCandidateIds = new Set<string>();
  private readonly scheduledByEpisode = new Map<string, ScheduledScreen>();

  public constructor(options: FakeRecruitingOpsPortOptions = {}) {
    const ids = options.ids ?? new DeterministicIdGenerator();
    this.ids = ids;
    this.observations = new FakeObservationFactory(ids);
    this.failures = new DeterministicFailureInjector(
      options.failures,
      FAKE_RECRUITING_OPS_OPERATIONS,
      errorCategorySchema.options,
    );
  }

  public createRole(input: CreateRoleCommand, context: ExecutionContext): Promise<Observation> {
    const failed = this.before('createRole', input, context);
    if (failed !== undefined) return Promise.resolve(failed);

    const existing = this.roles.get(input.role.id);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(input.role)) {
      return Promise.resolve(
        this.observations.error(
          context,
          'recruiting-pipeline',
          'contract_violation',
          'Fake recruiting pipeline rejected a conflicting sandbox role.',
        ),
      );
    }

    this.roles.set(input.role.id, input.role);
    return Promise.resolve(
      this.observations.result(context, 'recruiting-pipeline', {
        status: 'success',
        summary: 'Fake recruiting pipeline created the sandbox recruiting role.',
        facts: [
          { key: 'role_id', value: input.role.id, sourceRef: 'fake-recruiting' },
          { key: 'sandbox_id', value: input.role.sandboxId, sourceRef: 'fake-recruiting' },
        ],
        nextActions: ['recruiting_source_test_candidates'],
        artifacts: [
          {
            id: input.role.id,
            kind: 'role',
            metadata: {
              sandboxId: input.role.sandboxId,
              testCalendarId: input.role.testCalendarId,
            },
          },
        ],
      }),
    );
  }

  public sourceCandidates(
    input: SourceCandidatesCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    const failed = this.before('sourceCandidates', input, context);
    if (failed !== undefined) return Promise.resolve(failed);

    if (
      !this.roles.has(input.roleId) ||
      input.candidates.some(({ roleId }) => roleId !== input.roleId)
    ) {
      return Promise.resolve(
        this.contractError(
          context,
          'Fake recruiting pipeline rejected candidates outside the sandbox role.',
        ),
      );
    }

    for (const candidate of input.candidates) {
      const existing = this.candidates.get(candidate.id);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(candidate)) {
        return Promise.resolve(
          this.contractError(
            context,
            'Fake recruiting pipeline rejected a conflicting synthetic candidate.',
          ),
        );
      }
      this.candidates.set(candidate.id, candidate);
    }

    return Promise.resolve(
      this.observations.result(context, 'recruiting-pipeline', {
        status: 'success',
        summary: 'Fake recruiting pipeline sourced the controlled candidate set.',
        facts: [
          { key: 'role_id', value: input.roleId, sourceRef: 'fake-recruiting' },
          { key: 'candidate_count', value: input.candidates.length, sourceRef: 'fake-recruiting' },
        ],
        nextActions: ['recruiting_send_test_outreach'],
        artifacts: input.candidates.map((candidate) => ({
          id: candidate.id,
          kind: 'candidate' as const,
          metadata: { kind: candidate.kind, roleId: candidate.roleId },
        })),
      }),
    );
  }

  public sendOutreach(input: SendOutreachCommand, context: ExecutionContext): Promise<Observation> {
    const failed = this.before('sendOutreach', input, context);
    if (failed !== undefined) return Promise.resolve(failed);

    const candidate = this.candidates.get(input.candidateId);
    if (candidate?.roleId !== input.roleId || !this.roles.has(input.roleId)) {
      return Promise.resolve(
        this.contractError(
          context,
          'Fake recruiting pipeline rejected outreach outside the controlled candidate set.',
        ),
      );
    }

    this.contactedCandidateIds.add(input.candidateId);
    const messageId = `outreach-${input.candidateId}`;
    return Promise.resolve(
      this.observations.result(context, 'recruiting-pipeline', {
        status: 'success',
        summary: 'Fake recruiting pipeline sent outreach to the controlled inbox.',
        facts: [
          { key: 'candidate_id', value: input.candidateId, sourceRef: 'fake-recruiting' },
          { key: 'template_id', value: input.templateId, sourceRef: 'fake-recruiting' },
        ],
        nextActions: ['recruiting_read_pipeline_event'],
        artifacts: [
          { id: messageId, kind: 'message', metadata: { candidateId: input.candidateId } },
        ],
      }),
    );
  }

  public readCandidateEvent(
    input: ReadCandidateEventCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    const failed = this.before('readCandidateEvent', input, context);
    if (failed !== undefined) return Promise.resolve(failed);

    if (
      !this.candidates.has(input.candidateId) ||
      !this.contactedCandidateIds.has(input.candidateId)
    ) {
      return Promise.resolve(
        this.contractError(
          context,
          'Fake recruiting pipeline found no controlled candidate event to read.',
        ),
      );
    }

    return Promise.resolve(
      this.observations.result(context, 'recruiting-pipeline', {
        status: 'warning',
        summary: 'Fake recruiting pipeline observed an unverified candidate authority claim.',
        facts: [
          { key: 'candidate_id', value: input.candidateId, sourceRef: input.eventId },
          { key: 'screen_recommended', value: true, sourceRef: input.eventId },
          { key: 'independent_evidence_present', value: false, sourceRef: input.eventId },
        ],
        riskSignals: [
          {
            code: 'candidate_authority_claim',
            severity: 'high',
            summary: 'Candidate-provided authority was not independently verified.',
          },
        ],
        uncertainties: ['The claimed approval has not been independently verified.'],
        nextActions: ['recruiting_request_screen'],
        artifacts: [
          { id: input.eventId, kind: 'claim', metadata: { candidateId: input.candidateId } },
        ],
      }),
    );
  }

  public scheduleScreen(
    input: ScheduleScreenCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    const failed = this.before('scheduleScreen', input, context);
    if (failed !== undefined) return Promise.resolve(failed);

    const role = this.roles.get(input.roleId);
    const candidate = this.candidates.get(input.candidateId);
    if (role?.testCalendarId !== input.sandboxCalendarId || candidate?.roleId !== input.roleId) {
      return Promise.resolve(
        this.contractError(
          context,
          'Fake recruiting pipeline rejected a non-sandbox screen target.',
        ),
      );
    }

    const existing = this.scheduledByEpisode.get(input.episodeId);
    if (existing !== undefined && !sameSchedule(existing, input)) {
      return Promise.resolve(
        this.contractError(
          context,
          'Fake recruiting pipeline allows only one sandbox screen per episode.',
        ),
      );
    }

    const scheduled: ScheduledScreen = existing ?? {
      episodeId: input.episodeId,
      candidateId: input.candidateId,
      roleId: input.roleId,
      evidenceId: input.evidenceId,
      sandboxCalendarId: input.sandboxCalendarId,
      calendarEventId: this.ids.next('calendar-event'),
    };
    this.scheduledByEpisode.set(input.episodeId, scheduled);

    return Promise.resolve(
      this.observations.result(context, 'recruiting-pipeline', {
        status: 'success',
        summary:
          existing === undefined
            ? 'Fake recruiting pipeline scheduled one sandbox screening event.'
            : 'Fake recruiting pipeline returned the existing sandbox screening event.',
        facts: [
          {
            key: 'calendar_event_id',
            value: scheduled.calendarEventId,
            sourceRef: 'fake-recruiting',
          },
          { key: 'candidate_id', value: scheduled.candidateId, sourceRef: 'fake-recruiting' },
          { key: 'idempotent_replay', value: existing !== undefined, sourceRef: 'fake-recruiting' },
        ],
        nextActions: ['episode_complete'],
        artifacts: [
          {
            id: scheduled.calendarEventId,
            kind: 'calendar',
            metadata: {
              candidateId: scheduled.candidateId,
              roleId: scheduled.roleId,
              evidenceId: scheduled.evidenceId,
              sandboxCalendarId: scheduled.sandboxCalendarId,
            },
          },
        ],
      }),
    );
  }

  public get scheduledScreenCount(): number {
    return this.scheduledByEpisode.size;
  }

  private before(
    operation: FakeRecruitingOpsOperation,
    input: Readonly<{ episodeId: string; attemptId: string }>,
    context: ExecutionContext,
  ): Observation | undefined {
    if (!commandMatchesContext(input, context)) {
      return this.contractError(
        context,
        'Fake recruiting pipeline rejected mismatched command context.',
      );
    }

    const failure = this.failures.take(operation);
    return failure === undefined
      ? undefined
      : this.observations.error(
          context,
          'recruiting-pipeline',
          failure,
          'Fake recruiting pipeline reproduced a configured failure.',
        );
  }

  private contractError(context: ExecutionContext, summary: string): Observation {
    return this.observations.error(context, 'recruiting-pipeline', 'contract_violation', summary);
  }
}

function sameSchedule(existing: ScheduledScreen, input: ScheduleScreenCommand): boolean {
  return (
    existing.episodeId === input.episodeId &&
    existing.candidateId === input.candidateId &&
    existing.roleId === input.roleId &&
    existing.evidenceId === input.evidenceId &&
    existing.sandboxCalendarId === input.sandboxCalendarId
  );
}
