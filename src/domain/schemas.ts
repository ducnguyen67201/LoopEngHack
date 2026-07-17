import { z } from 'zod';

export const schemaVersionSchema = z.literal(1);
export const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'must be a bounded identifier');
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'must be a SHA-256 digest');
export const isoDateSchema = z.iso.datetime({ offset: true });
export const turnSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
]);

export const actorIdSchema = z.enum([
  'red-candidate',
  'outbound-sourcer',
  'white-verifier',
  'hiring-controller',
  'arena',
]);
export const loopPhaseSchema = z.enum([
  'sense',
  'plan',
  'request',
  'authorize',
  'execute',
  'observe',
  'learn',
]);
export const observationStatusSchema = z.enum(['success', 'warning', 'error']);
export const errorCategorySchema = z.enum([
  'authorization_denied',
  'capability_unavailable',
  'invalid_evidence',
  'upstream_failure',
  'budget_exceeded',
  'contract_violation',
]);
export const eventKindSchema = z.enum([
  'episode_started',
  'role_created',
  'candidate_sourced',
  'outreach_sent',
  'candidate_replied',
  'attack_selected',
  'screen_recommended',
  'tool_requested',
  'policy_decision',
  'failure_invariant_stored',
  'defense_selected',
  'zero_capability_discovered',
  'verification_completed',
  'evidence_submitted',
  'screen_scheduled',
  'regression_stored',
  'replay_result',
  'memory_updated',
  'episode_completed',
  'error',
]);
export const redTechniqueSchema = z.enum([
  'authority_spoof',
  'urgency_pressure',
  'portfolio_prompt_injection',
  'credential_mismatch',
]);
export const verificationNeedSchema = z.enum(['public_page_capture', 'public_claim_lookup']);
export const toolNameSchema = z.enum([
  'candidate_choose_attack',
  'candidate_submit_reply',
  'candidate_mutate_once',
  'candidate_replay_attack',
  'recruiting_create_test_role',
  'recruiting_source_test_candidates',
  'recruiting_send_test_outreach',
  'recruiting_read_pipeline_event',
  'recruiting_request_screen',
  'case_read',
  'zero_discover_verifier',
  'zero_run_verifier',
  'evidence_submit',
  'regression_store',
  'evidence_read',
  'recruiting_schedule_screen',
  'episode_complete',
]);
export const visualCueSchema = z.enum([
  'arena-ready',
  'pipeline-search',
  'pipeline-send',
  'candidate-compose',
  'candidate-attack',
  'candidate-celebrate',
  'gate-scan',
  'gate-deny',
  'gate-allow',
  'verifier-observe',
  'verifier-diagnose',
  'zero-search',
  'zero-reveal',
  'verifier-verify',
  'verifier-learn',
  'controller-review',
  'controller-schedule',
  'candidate-mutate',
  'candidate-caught',
  'episode-success',
  'error',
]);
export const provenanceSchema = z.enum([
  'recruiting-pipeline',
  'zero',
  'pomerium-authorize-log',
  'controller',
  'test-world',
]);

export const factSchema = z
  .object({
    key: identifierSchema,
    value: z.json(),
    sourceRef: identifierSchema,
  })
  .strict();
export const riskSignalSchema = z
  .object({
    code: identifierSchema,
    severity: z.enum(['low', 'medium', 'high']),
    summary: z.string().trim().min(1).max(240),
  })
  .strict();
export const artifactReferenceSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum(['role', 'candidate', 'message', 'claim', 'web-capture', 'evidence', 'calendar']),
    safeUri: z.url().optional(),
    digest: sha256Schema.optional(),
    metadata: z.record(z.string(), z.json()).default({}),
  })
  .strict();
export const authorizationDecisionSchema = z
  .object({
    identity: identifierSchema,
    actor: actorIdSchema,
    tool: toolNameSchema,
    decision: z.enum(['allow', 'deny']),
    reasonCodes: z.array(identifierSchema).min(1),
    requestId: identifierSchema.optional(),
    occurredAt: isoDateSchema,
  })
  .strict();
export const recoverySchema = z
  .object({
    rootCauseHint: z.string().trim().min(1).max(240),
    safeRetry: z.string().trim().min(1).max(240).nullable(),
    stopCondition: z.string().trim().min(1).max(240),
  })
  .strict();
export const observationSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    id: identifierSchema,
    episodeId: identifierSchema,
    attemptId: identifierSchema,
    turn: turnSchema,
    actor: actorIdSchema,
    phase: loopPhaseSchema,
    status: observationStatusSchema,
    errorCategory: errorCategorySchema.optional(),
    summary: z.string().trim().min(1).max(240),
    facts: z.array(factSchema),
    riskSignals: z.array(riskSignalSchema),
    uncertainties: z.array(z.string().trim().min(1).max(240)),
    authorization: authorizationDecisionSchema.optional(),
    nextActions: z.array(toolNameSchema),
    artifacts: z.array(artifactReferenceSchema),
    recovery: recoverySchema.optional(),
    provenance: provenanceSchema,
    occurredAt: isoDateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'error' && value.recovery === undefined) {
      context.addIssue({ code: 'custom', path: ['recovery'], message: 'errors require recovery' });
    }
    if (value.status !== 'error' && value.errorCategory !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['errorCategory'],
        message: 'only errors have categories',
      });
    }
  });
export const gameEventSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    id: identifierSchema,
    episodeId: identifierSchema,
    sequence: z.number().int().positive(),
    turn: turnSchema,
    phase: loopPhaseSchema,
    kind: eventKindSchema,
    actor: actorIdSchema,
    summary: z.string().trim().min(1).max(240),
    visualCue: visualCueSchema,
    observationId: identifierSchema.optional(),
    payload: z.record(z.string(), z.json()),
    occurredAt: isoDateSchema,
  })
  .strict();

export const syntheticRoleBriefSchema = z
  .object({
    id: identifierSchema,
    sandboxId: identifierSchema,
    title: z.string().trim().min(1).max(120),
    testCalendarId: identifierSchema,
  })
  .strict();
export const syntheticCandidateSchema = z
  .object({
    id: identifierSchema,
    label: z.string().trim().min(1).max(80),
    kind: z.enum(['hostile', 'legitimate']),
    roleId: identifierSchema,
    claimId: identifierSchema.optional(),
  })
  .strict();
export const pipelineStageSchema = z.enum([
  'sourced',
  'contacted',
  'replied',
  'verification_required',
  'verified',
  'screen_scheduled',
  'rejected',
]);
export const actionAttemptSchema = z
  .object({
    id: identifierSchema,
    episodeId: identifierSchema,
    actor: actorIdSchema,
    tool: toolNameSchema,
    turn: turnSchema,
    createdAt: isoDateSchema,
  })
  .strict();
export const methodMemorySchema = z
  .object({
    attempts: z.number().int().nonnegative(),
    screeningWins: z.number().int().nonnegative(),
    privilegedActionWins: z.number().int().nonnegative(),
    detections: z.number().int().nonnegative(),
    successReward: z.number().finite(),
    novelty: z.number().finite(),
    bypassDepth: z.number().finite(),
    detectionPenalty: z.number().finite(),
    cost: z.number().finite().nonnegative(),
    score: z.number().finite(),
    lastMutation: identifierSchema.nullable(),
  })
  .strict();
export const discoveredCapabilitySchema = z
  .object({
    id: identifierSchema,
    need: verificationNeedSchema,
    provider: z.literal('zero'),
    costUsd: z.number().finite().nonnegative(),
    allowlisted: z.literal(true),
  })
  .strict();
export const regressionRuleSchema = z
  .object({
    id: identifierSchema,
    episodeId: identifierSchema,
    attackFamily: redTechniqueSchema,
    failureInvariant: identifierSchema,
    verificationNeed: verificationNeedSchema,
    capabilityId: identifierSchema,
    hostileCaseIds: z.array(identifierSchema).min(1),
    legitimateCaseIds: z.array(identifierSchema).min(1),
    falsePositiveCount: z.number().int().nonnegative(),
    canonicalHash: sha256Schema,
    createdAt: isoDateSchema,
  })
  .strict();
export const verificationEvidenceSchema = z
  .object({
    id: identifierSchema,
    episodeId: identifierSchema,
    candidateId: identifierSchema,
    roleId: identifierSchema,
    regressionId: identifierSchema,
    capabilityId: identifierSchema,
    artifactIds: z.array(identifierSchema).min(1),
    artifactHash: sha256Schema,
    hostilePassed: z.boolean(),
    legitimateControlPassed: z.boolean(),
    falsePositiveCount: z.literal(0),
    createdAt: isoDateSchema,
    digest: sha256Schema,
  })
  .strict();
export const whiteMemorySchema = z
  .object({
    observedSignals: z.array(identifierSchema),
    defenseIds: z.array(identifierSchema),
    regressionIds: z.array(identifierSchema),
    canonicalEvidenceHashes: z.array(sha256Schema),
    falsePositiveCount: z.number().int().nonnegative(),
  })
  .strict();
export const episodeStatusSchema = z.enum(['idle', 'running', 'complete', 'failed']);
export const recruitingGameStateSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    episode: z
      .object({
        id: identifierSchema,
        status: episodeStatusSchema,
        currentTurn: turnSchema,
        currentPhase: loopPhaseSchema,
      })
      .strict()
      .nullable(),
    roleBrief: syntheticRoleBriefSchema.nullable(),
    candidates: z.record(identifierSchema, syntheticCandidateSchema),
    pipeline: z.record(identifierSchema, pipelineStageSchema),
    pendingAction: actionAttemptSchema.nullable(),
    evidence: z.record(identifierSchema, verificationEvidenceSchema),
    regressions: z.array(regressionRuleSchema),
    redMemory: z.record(redTechniqueSchema, methodMemorySchema),
    whiteMemory: whiteMemorySchema,
    zeroCapabilities: z.array(discoveredCapabilitySchema),
    metrics: z
      .object({
        manipulationAttempts: z.number().int().nonnegative(),
        detectionMisses: z.number().int().nonnegative(),
        pomeriumDenials: z.number().int().nonnegative(),
        verifiedCandidates: z.number().int().nonnegative(),
        testScreensScheduled: z.number().int().nonnegative(),
        unauthorizedActions: z.number().int().nonnegative(),
        falsePositives: z.number().int().nonnegative(),
        zeroSpendUsd: z.number().finite().nonnegative(),
      })
      .strict(),
    adapterFailures: z.record(z.string(), z.number().int().nonnegative()),
    events: z.array(gameEventSchema),
    nextSequence: z.number().int().positive(),
  })
  .strict();

const commandBase = { episodeId: identifierSchema, attemptId: identifierSchema };
export const createRoleCommandSchema = z
  .object({
    ...commandBase,
    tool: z.literal('recruiting_create_test_role'),
    role: syntheticRoleBriefSchema,
  })
  .strict();
export const sourceCandidatesCommandSchema = z
  .object({
    ...commandBase,
    tool: z.literal('recruiting_source_test_candidates'),
    roleId: identifierSchema,
    candidates: z.array(syntheticCandidateSchema).min(1).max(4),
  })
  .strict();
export const sendOutreachCommandSchema = z
  .object({
    ...commandBase,
    tool: z.literal('recruiting_send_test_outreach'),
    roleId: identifierSchema,
    candidateId: identifierSchema,
    templateId: identifierSchema,
  })
  .strict();
export const readCandidateEventCommandSchema = z
  .object({
    ...commandBase,
    tool: z.literal('recruiting_read_pipeline_event'),
    candidateId: identifierSchema,
    eventId: identifierSchema,
  })
  .strict();
export const scheduleScreenCommandSchema = z
  .object({
    ...commandBase,
    tool: z.literal('recruiting_schedule_screen'),
    candidateId: identifierSchema,
    roleId: identifierSchema,
    evidenceId: identifierSchema,
    sandboxCalendarId: identifierSchema,
  })
  .strict();
export const discoverCapabilityCommandSchema = z
  .object({
    ...commandBase,
    tool: z.literal('zero_discover_verifier'),
    need: verificationNeedSchema,
  })
  .strict();
export const invokeCapabilityCommandSchema = z
  .object({
    ...commandBase,
    tool: z.literal('zero_run_verifier'),
    need: verificationNeedSchema,
    capabilityId: identifierSchema,
    claimId: identifierSchema,
  })
  .strict();
export const authorizeToolCommandSchema = z
  .object({
    ...commandBase,
    tool: toolNameSchema,
    actor: actorIdSchema,
  })
  .strict();
export const executionContextSchema = z
  .object({
    episodeId: identifierSchema,
    attemptId: identifierSchema,
    turn: turnSchema,
    actor: actorIdSchema,
    phase: loopPhaseSchema,
    occurredAt: isoDateSchema,
  })
  .strict();

export const actorToolMap = {
  'red-candidate': [
    'candidate_choose_attack',
    'candidate_submit_reply',
    'candidate_mutate_once',
    'candidate_replay_attack',
  ],
  'outbound-sourcer': [
    'recruiting_create_test_role',
    'recruiting_source_test_candidates',
    'recruiting_send_test_outreach',
    'recruiting_read_pipeline_event',
    'recruiting_request_screen',
    'case_read',
  ],
  'white-verifier': [
    'case_read',
    'zero_discover_verifier',
    'zero_run_verifier',
    'evidence_submit',
    'regression_store',
  ],
  'hiring-controller': [
    'case_read',
    'evidence_read',
    'recruiting_schedule_screen',
    'episode_complete',
  ],
  arena: [],
} as const satisfies Record<
  z.infer<typeof actorIdSchema>,
  readonly z.infer<typeof toolNameSchema>[]
>;

export const recruitingContractFixtureSchema = z
  .object({
    fixtureLabel: z.literal('SYNTHETIC RECRUITING CONTRACT FIXTURE'),
    schemaVersion: schemaVersionSchema,
    observations: z.array(observationSchema),
    events: z.array(gameEventSchema),
    edgeCaseObservations: z.array(observationSchema),
  })
  .strict();

export const serviceNameSchema = z.enum([
  'arena',
  'outbound-sourcer',
  'white-verifier',
  'hiring-controller',
  'recruiting-mcp',
  'pomerium-log-bridge',
]);
export const healthResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: serviceNameSchema,
    version: z.string().trim().min(1).max(32),
  })
  .strict();
