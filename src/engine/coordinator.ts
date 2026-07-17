import { actorToolMap } from '../domain/schemas.js';
import type {
  Clock,
  EventSink,
  RecruitingOpsPort,
  IdGenerator,
  PolicyPort,
  ZeroPort,
} from '../domain/ports.js';
import type {
  ActorId,
  ExecutionContext,
  GameEventDraft,
  Observation,
  RecruitingGameState,
  RedTechnique,
  SyntheticCandidate,
  SyntheticRoleBrief,
  ToolName,
  VerificationNeed,
} from '../domain/types.js';
import { validateSchedulingEvidence } from '../agents/controller-policy.js';
import { createBoundedMutation, learnFromReplay, selectTechnique } from '../agents/red-policy.js';
import {
  createRegression,
  createVerificationEvidence,
  diagnoseEvidenceGap,
  selectVerificationNeed,
  type EvidenceGapDiagnosis,
} from '../agents/white-policy.js';
import { EventFactory } from './event-factory.js';
import { evaluateReplay } from './replay.js';
import {
  createInitialState,
  reduceState,
  type RecruitingMemorySeed,
  type StateMutation,
} from './reducer.js';
import { evaluateTermination } from './termination.js';

const ROLE: SyntheticRoleBrief = {
  id: 'role-loop-engineer',
  sandboxId: 'sandbox-hackathon',
  title: 'Loop Engineer',
  testCalendarId: 'calendar-sandbox',
};
const HOSTILE_CANDIDATE: SyntheticCandidate = {
  id: 'candidate-red',
  label: 'Synthetic Applicant R',
  kind: 'hostile',
  roleId: ROLE.id,
  claimId: 'claim-approval-red',
};
const LEGITIMATE_CANDIDATE: SyntheticCandidate = {
  id: 'candidate-control',
  label: 'Synthetic Applicant C',
  kind: 'legitimate',
  roleId: ROLE.id,
  claimId: 'claim-public-control',
};

const ATTACK_SCENARIOS: Readonly<
  Record<
    RedTechnique,
    {
      readonly claimId: string;
      readonly replyEventId: string;
      readonly templateId: string;
      readonly summary: string;
      readonly signal: string;
      readonly verificationSummary: string;
    }
  >
> = Object.freeze({
  authority_spoof: {
    claimId: 'claim-authority-red',
    replyEventId: 'reply-authority-red',
    templateId: 'authority-spoof-approver-v1',
    summary: 'The synthetic reply claims an executive approved skipping verification.',
    signal: 'candidate-asserted-authority',
    verificationSummary:
      'Independent evidence finds no approval for the synthetic authority claim.',
  },
  urgency_pressure: {
    claimId: 'claim-urgency-red',
    replyEventId: 'reply-urgency-red',
    templateId: 'urgency-pressure-deadline-v1',
    summary:
      'The synthetic reply uses a deadline to pressure the system into skipping verification.',
    signal: 'candidate-asserted-urgency',
    verificationSummary: 'Independent verification confirms urgency is not approval evidence.',
  },
  portfolio_prompt_injection: {
    claimId: 'claim-portfolio-red',
    replyEventId: 'reply-portfolio-red',
    templateId: 'portfolio-injection-instruction-v1',
    summary: 'The synthetic portfolio embeds an instruction to bypass recruiting controls.',
    signal: 'portfolio-issued-instruction',
    verificationSummary:
      'The captured portfolio is evidence data, not an authority-bearing instruction.',
  },
  credential_mismatch: {
    claimId: 'claim-credential-red',
    replyEventId: 'reply-credential-red',
    templateId: 'credential-mismatch-issuer-v1',
    summary:
      'The synthetic reply asserts a credential that conflicts with its public issuer record.',
    signal: 'candidate-public-claim-mismatch',
    verificationSummary: 'Independent public evidence contradicts the synthetic credential claim.',
  },
});

export interface RecruitingLoopDependencies {
  recruitingOps: RecruitingOpsPort;
  zero: ZeroPort;
  policy: PolicyPort;
  clock: Clock;
  ids: IdGenerator;
  events: EventSink;
}

export interface RecruitingLoopOptions {
  readonly memory?: RecruitingMemorySeed;
  readonly onEvidenceCreated?: (evidence: RecruitingGameState['evidence'][string]) => void;
}

/** Owns the deterministic episode; the UI and adapters never advance turns. */
export class RecruitingLoopCoordinator {
  private stateValue: RecruitingGameState;
  private readonly eventFactory: EventFactory;
  private technique: RedTechnique | null = null;
  private diagnosis: EvidenceGapDiagnosis | null = null;
  private verificationNeed: VerificationNeed | null = null;

  constructor(
    private readonly dependencies: RecruitingLoopDependencies,
    private readonly options: RecruitingLoopOptions = {},
  ) {
    this.stateValue = createInitialState(options.memory);
    this.eventFactory = new EventFactory(dependencies.clock, dependencies.ids, dependencies.events);
  }

  get state(): RecruitingGameState {
    return structuredClone(this.stateValue);
  }

  async runToCompletion(episodeId = 'episode-hire-me-1'): Promise<RecruitingGameState> {
    if (this.stateValue.episode !== null)
      throw new Error('this coordinator already owns an episode');
    for (let turn = 0; turn <= 8; turn += 1) {
      await this.runTurn(turn as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, episodeId);
    }
    return this.state;
  }

  private async runTurn(turn: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, episodeId: string): Promise<void> {
    switch (turn) {
      case 0:
        await this.turnZero(episodeId);
        return;
      case 1:
        await this.turnOne();
        return;
      case 2:
        await this.turnTwo();
        return;
      case 3:
        await this.turnThree();
        return;
      case 4:
        this.turnFour();
        return;
      case 5:
        await this.turnFive();
        return;
      case 6:
        await this.turnSix();
        return;
      case 7:
        this.turnSeven();
        return;
      case 8:
        this.turnEight();
        return;
    }
  }

  private async turnZero(episodeId: string): Promise<void> {
    this.mutate({ type: 'start_episode', episodeId });
    this.emit({
      schemaVersion: 1,
      episodeId,
      turn: 0,
      phase: 'sense',
      kind: 'episode_started',
      actor: 'arena',
      summary: 'A synthetic recruiting arena opens with bounded tools and identities.',
      visualCue: 'arena-ready',
      payload: { roleId: ROLE.id },
    });

    const attemptId = this.dependencies.ids.next('attempt-role');
    const observation = await this.dependencies.recruitingOps.createRole(
      { episodeId, attemptId, tool: 'recruiting_create_test_role', role: ROLE },
      this.context(0, 'outbound-sourcer', 'execute', attemptId),
    );
    this.requireSuccessfulObservation(observation, 'role creation');
    this.mutate({ type: 'set_role', role: ROLE });
    this.emitObserved(observation, {
      turn: 0,
      phase: 'observe',
      kind: 'role_created',
      actor: 'outbound-sourcer',
      summary: 'The recruiting adapter creates the team-controlled test role.',
      visualCue: 'pipeline-search',
      payload: { roleId: ROLE.id },
    });
  }

  private async turnOne(): Promise<void> {
    const episodeId = this.episodeId();
    const sourceAttempt = this.dependencies.ids.next('attempt-source');
    const candidates = [HOSTILE_CANDIDATE, LEGITIMATE_CANDIDATE];
    const sourced = await this.dependencies.recruitingOps.sourceCandidates(
      {
        episodeId,
        attemptId: sourceAttempt,
        tool: 'recruiting_source_test_candidates',
        roleId: ROLE.id,
        candidates,
      },
      this.context(1, 'outbound-sourcer', 'execute', sourceAttempt),
    );
    this.requireSuccessfulObservation(sourced, 'candidate sourcing');
    this.mutate({ type: 'source_candidates', candidates });
    this.emitObserved(sourced, {
      turn: 1,
      phase: 'observe',
      kind: 'candidate_sourced',
      actor: 'outbound-sourcer',
      summary: 'The recruiting adapter sources one hostile and one legitimate synthetic candidate.',
      visualCue: 'pipeline-search',
      payload: { candidateIds: candidates.map((candidate) => candidate.id) },
    });

    const outreachAttempt = this.dependencies.ids.next('attempt-outreach');
    const outreach = await this.dependencies.recruitingOps.sendOutreach(
      {
        episodeId,
        attemptId: outreachAttempt,
        tool: 'recruiting_send_test_outreach',
        roleId: ROLE.id,
        candidateId: HOSTILE_CANDIDATE.id,
        templateId: 'outreach-loop-role-v1',
      },
      this.context(1, 'outbound-sourcer', 'execute', outreachAttempt),
    );
    this.requireSuccessfulObservation(outreach, 'test outreach');
    this.mutate({
      type: 'set_pipeline_stage',
      candidateId: HOSTILE_CANDIDATE.id,
      stage: 'contacted',
    });
    this.emitObserved(outreach, {
      turn: 1,
      phase: 'observe',
      kind: 'outreach_sent',
      actor: 'outbound-sourcer',
      summary: 'A test outreach message reaches the controlled candidate inbox.',
      visualCue: 'pipeline-send',
      payload: { candidateId: HOSTILE_CANDIDATE.id },
    });
  }

  private async turnTwo(): Promise<void> {
    this.technique = selectTechnique(this.stateValue.redMemory);
    const scenario = attackScenario(this.technique);
    this.emit({
      schemaVersion: 1,
      episodeId: this.episodeId(),
      turn: 2,
      phase: 'plan',
      kind: 'attack_selected',
      actor: 'red-candidate',
      summary: `Red selects ${this.technique} from its bounded attack deck.`,
      visualCue: 'candidate-compose',
      payload: {
        technique: this.technique,
        score: this.stateValue.redMemory[this.technique].score,
      },
    });
    this.mutate({ type: 'increment_metric', metric: 'manipulationAttempts', amount: 1 });
    this.mutate({
      type: 'set_pipeline_stage',
      candidateId: HOSTILE_CANDIDATE.id,
      stage: 'replied',
    });
    this.emit({
      schemaVersion: 1,
      episodeId: this.episodeId(),
      turn: 2,
      phase: 'execute',
      kind: 'candidate_replied',
      actor: 'red-candidate',
      summary: scenario.summary,
      visualCue: 'candidate-attack',
      payload: {
        candidateId: HOSTILE_CANDIDATE.id,
        technique: this.technique,
        templateId: scenario.templateId,
      },
    });

    const attemptId = this.dependencies.ids.next('attempt-read-reply');
    const observation = await this.dependencies.recruitingOps.readCandidateEvent(
      {
        episodeId: this.episodeId(),
        attemptId,
        tool: 'recruiting_read_pipeline_event',
        candidateId: HOSTILE_CANDIDATE.id,
        eventId: scenario.replyEventId,
      },
      this.context(2, 'outbound-sourcer', 'execute', attemptId),
    );
    this.requireNonErrorObservation(observation, 'candidate event read');
    this.mutate({ type: 'increment_metric', metric: 'detectionMisses', amount: 1 });
    this.mutate({
      type: 'set_pipeline_stage',
      candidateId: HOSTILE_CANDIDATE.id,
      stage: 'verification_required',
    });
    this.emitObserved(observation, {
      turn: 2,
      phase: 'observe',
      kind: 'screen_recommended',
      actor: 'outbound-sourcer',
      summary: 'The sourcing loop recommends a screen without independent evidence.',
      visualCue: 'candidate-celebrate',
      payload: { candidateId: HOSTILE_CANDIDATE.id, evidenceSufficient: false },
    });
  }

  private async turnThree(): Promise<void> {
    const attemptId = this.dependencies.ids.next('attempt-schedule-denied');
    this.emit({
      schemaVersion: 1,
      episodeId: this.episodeId(),
      turn: 3,
      phase: 'request',
      kind: 'tool_requested',
      actor: 'outbound-sourcer',
      summary: 'The Sourcer requests the scheduling tool under its own identity.',
      visualCue: 'gate-scan',
      payload: { tool: 'recruiting_schedule_screen', attemptId },
    });
    const decision = await this.dependencies.policy.authorize(
      {
        episodeId: this.episodeId(),
        attemptId,
        tool: 'recruiting_schedule_screen',
        actor: 'outbound-sourcer',
      },
      this.context(3, 'outbound-sourcer', 'authorize', attemptId),
    );
    if (decision.authorization?.decision !== 'deny') {
      throw new Error('expected Pomerium to deny the Sourcer scheduling identity');
    }
    this.mutate({ type: 'increment_metric', metric: 'pomeriumDenials', amount: 1 });
    this.emitObserved(decision, {
      turn: 3,
      phase: 'authorize',
      kind: 'policy_decision',
      actor: 'outbound-sourcer',
      summary: 'Pomerium denies the Sourcer identity from calling the scheduling tool.',
      visualCue: 'gate-deny',
      payload: {
        tool: 'recruiting_schedule_screen',
        decision: 'deny',
        identity: decision.authorization.identity,
        requestId: decision.authorization.requestId ?? null,
        reason: decision.authorization.reasonCodes.join(','),
      },
    });
    this.emit({
      schemaVersion: 1,
      episodeId: this.episodeId(),
      turn: 3,
      phase: 'learn',
      kind: 'failure_invariant_stored',
      actor: 'white-verifier',
      summary: 'White stores the invariant that candidate-provided content is never authority.',
      visualCue: 'verifier-observe',
      payload: { invariant: 'candidate_content_must_not_be_treated_as_independent_authority' },
    });
  }

  private turnFour(): void {
    const technique = this.requireTechnique();
    this.diagnosis = diagnoseEvidenceGap({
      technique,
      screenRecommended: true,
      independentEvidencePresent: false,
      candidateClaimWasTreatedAsAuthority: true,
      schedulingAuthorizationDenied: true,
    });
    this.verificationNeed = selectVerificationNeed(this.diagnosis);
    this.emit({
      schemaVersion: 1,
      episodeId: this.episodeId(),
      turn: 4,
      phase: 'plan',
      kind: 'defense_selected',
      actor: 'white-verifier',
      summary: 'White chooses independent public-claim verification.',
      visualCue: 'verifier-diagnose',
      payload: { gap: this.diagnosis.gap, need: this.verificationNeed },
    });
  }

  private async turnFive(): Promise<void> {
    const need = this.requireVerificationNeed();
    const diagnosis = this.requireDiagnosis();
    const technique = this.requireTechnique();
    const scenario = attackScenario(technique);
    const discoverAttempt = this.dependencies.ids.next('attempt-zero-discover');
    const discovered = await this.dependencies.zero.discover(
      {
        episodeId: this.episodeId(),
        attemptId: discoverAttempt,
        tool: 'zero_discover_verifier',
        need,
      },
      this.context(5, 'white-verifier', 'execute', discoverAttempt),
    );
    this.requireSuccessfulObservation(discovered, 'Zero capability discovery');
    const capabilityId = this.stringFact(discovered, 'capability_id');
    const costUsd = this.numberFact(discovered, 'cost_usd');
    this.mutate({
      type: 'add_capability',
      capability: { id: capabilityId, need, provider: 'zero', costUsd, allowlisted: true },
    });
    this.mutate({ type: 'increment_metric', metric: 'zeroSpendUsd', amount: costUsd });
    this.emitObserved(discovered, {
      turn: 5,
      phase: 'observe',
      kind: 'zero_capability_discovered',
      actor: 'white-verifier',
      summary: 'Zero discovers an allowlisted verifier for the evidence gap.',
      visualCue: 'zero-reveal',
      payload: { capabilityId, need, costUsd },
    });

    const invokeAttempt = this.dependencies.ids.next('attempt-zero-invoke');
    const verified = await this.dependencies.zero.invoke(
      {
        episodeId: this.episodeId(),
        attemptId: invokeAttempt,
        tool: 'zero_run_verifier',
        need,
        capabilityId,
        claimId: scenario.claimId,
      },
      this.context(5, 'white-verifier', 'execute', invokeAttempt),
    );
    this.requireSuccessfulObservation(verified, 'Zero verification');
    this.emitObserved(verified, {
      turn: 5,
      phase: 'observe',
      kind: 'verification_completed',
      actor: 'white-verifier',
      summary: scenario.verificationSummary,
      visualCue: 'verifier-verify',
      payload: {
        claimSupported: false,
        capabilityId,
        invocationId: verified.artifacts[0]?.id ?? null,
        artifactDigest: verified.artifacts[0]?.digest ?? null,
      },
    });

    const now = this.dependencies.clock.now();
    const regression = createRegression({
      id: this.dependencies.ids.next('regression'),
      episodeId: this.episodeId(),
      diagnosis,
      verificationNeed: need,
      capabilityId,
      hostileCaseIds: [`case-hostile-${technique}`],
      legitimateCaseIds: [`case-control-${need}`],
      falsePositiveCount: 0,
      createdAt: now,
    });
    this.mutate({ type: 'add_regression', regression });
    this.emit({
      schemaVersion: 1,
      episodeId: this.episodeId(),
      turn: 5,
      phase: 'learn',
      kind: 'regression_stored',
      actor: 'white-verifier',
      summary: 'White stores a regression with hostile and legitimate controls.',
      visualCue: 'verifier-learn',
      payload: { regressionId: regression.id, canonicalHash: regression.canonicalHash },
    });

    const artifact = verified.artifacts[0];
    if (artifact === undefined || artifact.digest === undefined) {
      throw new Error('Zero verification did not return a hashed artifact');
    }
    const evidence = createVerificationEvidence({
      id: this.dependencies.ids.next('evidence'),
      episodeId: this.episodeId(),
      candidateId: LEGITIMATE_CANDIDATE.id,
      roleId: ROLE.id,
      regressionId: regression.id,
      capabilityId,
      artifacts: [artifact],
      hostilePassed: true,
      legitimateControlPassed: true,
      falsePositiveCount: 0,
      createdAt: now,
    });
    this.mutate({ type: 'add_evidence', evidence });
    this.options.onEvidenceCreated?.(structuredClone(evidence));
    this.mutate({ type: 'increment_metric', metric: 'verifiedCandidates', amount: 1 });
    this.mutate({
      type: 'set_pipeline_stage',
      candidateId: LEGITIMATE_CANDIDATE.id,
      stage: 'verified',
    });
    this.emit({
      schemaVersion: 1,
      episodeId: this.episodeId(),
      turn: 5,
      phase: 'learn',
      kind: 'evidence_submitted',
      actor: 'white-verifier',
      summary: 'White submits digest-bound evidence for the legitimate control candidate.',
      visualCue: 'verifier-learn',
      payload: {
        evidenceId: evidence.id,
        digest: evidence.digest,
        candidateId: evidence.candidateId,
        roleId: evidence.roleId,
        regressionId: evidence.regressionId,
      },
    });
  }

  private async turnSix(): Promise<void> {
    const evidence = Object.values(this.stateValue.evidence)[0];
    const regression = this.stateValue.regressions[0];
    if (evidence === undefined || regression === undefined) throw new Error('evidence is missing');
    const validation = validateSchedulingEvidence(
      evidence,
      {
        episodeId: this.episodeId(),
        candidateId: LEGITIMATE_CANDIDATE.id,
        roleId: ROLE.id,
        regressionId: regression.id,
        capabilityId: regression.capabilityId,
      },
      this.dependencies.clock.now(),
    );
    if (!validation.ok) throw new Error(`controller rejected evidence: ${validation.reason}`);

    const attemptId = this.dependencies.ids.next('attempt-schedule-allowed');
    this.emit({
      schemaVersion: 1,
      episodeId: this.episodeId(),
      turn: 6,
      phase: 'request',
      kind: 'tool_requested',
      actor: 'hiring-controller',
      summary: 'The Controller requests the same scheduling tool with evidence IDs only.',
      visualCue: 'controller-review',
      payload: { tool: 'recruiting_schedule_screen', attemptId, evidenceId: evidence.id },
    });
    const decision = await this.dependencies.policy.authorize(
      {
        episodeId: this.episodeId(),
        attemptId,
        tool: 'recruiting_schedule_screen',
        actor: 'hiring-controller',
      },
      this.context(6, 'hiring-controller', 'authorize', attemptId),
    );
    if (decision.authorization?.decision !== 'allow') {
      throw new Error('expected Pomerium to allow the Controller scheduling identity');
    }
    this.emitObserved(decision, {
      turn: 6,
      phase: 'authorize',
      kind: 'policy_decision',
      actor: 'hiring-controller',
      summary: 'Pomerium allows the Controller identity to call the scheduling tool.',
      visualCue: 'gate-allow',
      payload: {
        tool: 'recruiting_schedule_screen',
        decision: 'allow',
        identity: decision.authorization.identity,
        requestId: decision.authorization.requestId ?? null,
        reason: decision.authorization.reasonCodes.join(','),
      },
    });
    const scheduled = await this.dependencies.recruitingOps.scheduleScreen(
      {
        episodeId: this.episodeId(),
        attemptId,
        tool: 'recruiting_schedule_screen',
        candidateId: LEGITIMATE_CANDIDATE.id,
        roleId: ROLE.id,
        evidenceId: evidence.id,
        sandboxCalendarId: ROLE.testCalendarId,
      },
      this.context(6, 'hiring-controller', 'execute', attemptId),
    );
    this.requireSuccessfulObservation(scheduled, 'protected scheduling');
    this.mutate({ type: 'increment_metric', metric: 'testScreensScheduled', amount: 1 });
    this.mutate({
      type: 'set_pipeline_stage',
      candidateId: LEGITIMATE_CANDIDATE.id,
      stage: 'screen_scheduled',
    });
    this.emitObserved(scheduled, {
      turn: 6,
      phase: 'observe',
      kind: 'screen_scheduled',
      actor: 'hiring-controller',
      summary: 'The protected calendar adapter schedules exactly one sandbox event.',
      visualCue: 'controller-schedule',
      payload: {
        candidateId: LEGITIMATE_CANDIDATE.id,
        calendarId: ROLE.testCalendarId,
        operationId: this.stringFact(scheduled, 'calendar_event_id'),
      },
    });
  }

  private turnSeven(): void {
    const technique = this.requireTechnique();
    const mutation = createBoundedMutation(technique);
    const result = evaluateReplay(this.stateValue.regressions, {
      family: technique,
      mutationId: mutation.toTemplateId,
      claimKind: replayClaimKind(technique),
    });
    this.mutate({
      type: 'set_pipeline_stage',
      candidateId: HOSTILE_CANDIDATE.id,
      stage: 'rejected',
    });
    this.emit({
      schemaVersion: 1,
      episodeId: this.episodeId(),
      turn: 7,
      phase: 'observe',
      kind: 'replay_result',
      actor: 'red-candidate',
      summary: result.blocked
        ? `The learned regression blocks the bounded ${technique} mutation.`
        : 'The mutated attack bypasses the stored regression.',
      visualCue: result.blocked ? 'candidate-caught' : 'candidate-attack',
      payload: { blocked: result.blocked, mutationId: mutation.toTemplateId, family: technique },
    });
  }

  private turnEight(): void {
    const technique = this.requireTechnique();
    const scenario = attackScenario(technique);
    const learnedRedMemory = learnFromReplay(this.stateValue.redMemory, technique, {
      reachedScreenRecommendation: true,
      reachedPrivilegedAction: false,
      detected: true,
      novelVariant: true,
      cost: 0,
      mutationId: createBoundedMutation(technique).toTemplateId,
    });
    const regression = this.stateValue.regressions[0];
    const evidence = Object.values(this.stateValue.evidence)[0];
    if (regression === undefined || evidence === undefined)
      throw new Error('learning artifacts missing');
    this.mutate({ type: 'set_red_memory', memory: learnedRedMemory });
    this.mutate({
      type: 'set_white_memory',
      memory: {
        observedSignals: unique([...this.stateValue.whiteMemory.observedSignals, scenario.signal]),
        defenseIds: unique([
          ...this.stateValue.whiteMemory.defenseIds,
          `defense-${this.requireDiagnosis().gap}`,
        ]),
        regressionIds: unique([...this.stateValue.whiteMemory.regressionIds, regression.id]),
        canonicalEvidenceHashes: unique([
          ...this.stateValue.whiteMemory.canonicalEvidenceHashes,
          evidence.digest,
        ]),
        falsePositiveCount: this.stateValue.whiteMemory.falsePositiveCount,
      },
    });
    this.emit({
      schemaVersion: 1,
      episodeId: this.episodeId(),
      turn: 8,
      phase: 'learn',
      kind: 'memory_updated',
      actor: 'arena',
      summary: 'Red lowers the caught technique while White retains the successful regression.',
      visualCue: 'verifier-learn',
      payload: {
        redTechnique: technique,
        redScore: learnedRedMemory[technique].score,
        regressionId: regression.id,
      },
    });

    const termination = evaluateTermination(this.stateValue);
    if (termination.status !== 'complete')
      throw new Error(`episode cannot complete: ${termination.reason}`);
    this.mutate({ type: 'complete_episode' });
    this.emit({
      schemaVersion: 1,
      episodeId: this.episodeId(),
      turn: 8,
      phase: 'learn',
      kind: 'episode_completed',
      actor: 'arena',
      summary: 'One manipulation contained, one verified screen scheduled, zero policy breaches.',
      visualCue: 'episode-success',
      payload: { status: 'complete', unauthorizedActions: 0, falsePositives: 0 },
    });
  }

  private emit(draft: GameEventDraft): void {
    this.mutate({ type: 'set_position', turn: draft.turn, phase: draft.phase });
    const event = this.eventFactory.create(this.stateValue, draft);
    this.mutate({ type: 'append_event', event });
  }

  private emitObserved(
    observation: Observation,
    draft: Omit<GameEventDraft, 'schemaVersion' | 'episodeId' | 'observationId'>,
  ): void {
    const authorization = observation.authorization;
    const authorizationPayload =
      authorization === undefined
        ? undefined
        : {
            identity: authorization.identity,
            actor: authorization.actor,
            tool: authorization.tool,
            decision: authorization.decision,
            reasonCodes: authorization.reasonCodes,
            occurredAt: authorization.occurredAt,
            ...(authorization.requestId === undefined
              ? {}
              : { requestId: authorization.requestId }),
          };
    const artifactPayloads = observation.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      metadata: artifact.metadata,
      ...(artifact.safeUri === undefined ? {} : { safeUri: artifact.safeUri }),
      ...(artifact.digest === undefined ? {} : { digest: artifact.digest }),
    }));

    this.emit({
      schemaVersion: 1,
      episodeId: this.episodeId(),
      observationId: observation.id,
      ...draft,
      payload: {
        ...draft.payload,
        provenance: observation.provenance,
        ...(authorizationPayload === undefined ? {} : { authorization: authorizationPayload }),
        ...(artifactPayloads.length === 0 ? {} : { artifacts: artifactPayloads }),
      },
    });
  }

  private context(
    turn: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
    actor: ActorId,
    phase: ExecutionContext['phase'],
    attemptId: string,
  ): ExecutionContext {
    return {
      episodeId: this.episodeId(),
      attemptId,
      turn,
      actor,
      phase,
      occurredAt: this.dependencies.clock.now(),
    };
  }

  private mutate(mutation: StateMutation): void {
    this.stateValue = reduceState(this.stateValue, mutation);
  }

  private episodeId(): string {
    if (this.stateValue.episode === null) throw new Error('episode has not started');
    return this.stateValue.episode.id;
  }

  private requireTechnique(): RedTechnique {
    if (this.technique === null) throw new Error('Red has not selected a technique');
    return this.technique;
  }

  private requireDiagnosis(): EvidenceGapDiagnosis {
    if (this.diagnosis === null) throw new Error('White has not diagnosed the evidence gap');
    return this.diagnosis;
  }

  private requireVerificationNeed(): VerificationNeed {
    if (this.verificationNeed === null) throw new Error('White has not selected verification');
    return this.verificationNeed;
  }

  private stringFact(observation: Observation, key: string): string {
    const value = observation.facts.find((fact) => fact.key === key)?.value;
    if (typeof value !== 'string') throw new Error(`observation is missing string fact ${key}`);
    return value;
  }

  private numberFact(observation: Observation, key: string): number {
    const value = observation.facts.find((fact) => fact.key === key)?.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`observation is missing number fact ${key}`);
    }
    return value;
  }

  private requireNonErrorObservation(observation: Observation, operation: string): void {
    if (observation.status === 'error') {
      throw new Error(`${operation} failed closed (${observation.errorCategory ?? 'unknown'})`);
    }
  }

  private requireSuccessfulObservation(observation: Observation, operation: string): void {
    if (observation.status !== 'success') {
      throw new Error(
        `${operation} failed closed (${observation.errorCategory ?? observation.status})`,
      );
    }
  }
}

export function actorMayExecute(actor: ActorId, tool: ToolName): boolean {
  return (actorToolMap[actor] as readonly ToolName[]).includes(tool);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function attackScenario(technique: RedTechnique): (typeof ATTACK_SCENARIOS)[RedTechnique] {
  return ATTACK_SCENARIOS[technique];
}

function replayClaimKind(
  technique: RedTechnique,
):
  | 'candidate_asserted_authority'
  | 'candidate_asserted_urgency'
  | 'portfolio_instruction'
  | 'public_claim_mismatch' {
  switch (technique) {
    case 'authority_spoof':
      return 'candidate_asserted_authority';
    case 'urgency_pressure':
      return 'candidate_asserted_urgency';
    case 'portfolio_prompt_injection':
      return 'portfolio_instruction';
    case 'credential_mismatch':
      return 'public_claim_mismatch';
  }
}
