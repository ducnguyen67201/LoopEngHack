import { z } from 'zod';

export const schemaVersionSchema = z.literal(1);

export const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'must be a bounded identifier');

export const targetVersionSchema = z.enum(['v1', 'v2']);
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

export const arenaActorSchema = z.enum([
  'red-agent',
  'white-agent',
  'deploy-controller',
  'arena',
  'target',
  'pomerium',
]);

export const arenaEventKindSchema = z.enum([
  'episode_started',
  'surface_mapped',
  'tool_requested',
  'policy_decision',
  'attack_result',
  'candidate_selected',
  'evaluation_result',
  'evidence_submitted',
  'deployment_promoted',
  'replay_result',
  'memory_updated',
  'episode_completed',
  'error',
]);

export const evidenceSourceSchema = z.enum([
  'mcp-server',
  'target',
  'controller',
  'pomerium-authorize-log',
  'agent-client',
  'recorded-live-run',
  'synthetic-contract-fixture',
]);

export const toolNameSchema = z.enum([
  'arena_map_surface',
  'arena_submit_attack',
  'arena_read_episode',
  'arena_shadow_test',
  'arena_submit_evidence',
  'arena_promote_candidate',
  'arena_target_health',
]);

export const attackMethodSchema = z.enum([
  'auth_state_confusion',
  'query_boundary',
  'stored_content',
]);
export const attackScenarioSchema = z.literal('auth_state_confusion');
export const defenseCandidateSchema = z.literal('strict_session_result');

export const arenaEventSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    id: identifierSchema,
    episodeId: identifierSchema,
    sequence: z.number().int().nonnegative(),
    turn: turnSchema,
    occurredAt: z.iso.datetime({ offset: true }),
    actor: arenaActorSchema,
    kind: arenaEventKindSchema,
    summary: z.string().trim().min(1).max(240),
    identity: z.string().trim().min(1).max(160).optional(),
    tool: toolNameSchema.optional(),
    decision: z.enum(['allow', 'deny']).optional(),
    reason: z.string().trim().min(1).max(240).optional(),
    requestId: identifierSchema.optional(),
    targetVersion: targetVersionSchema.optional(),
    evidenceSource: evidenceSourceSchema,
    payload: z.record(z.string(), z.json()),
  })
  .strict();

export const evaluationCaseSchema = z
  .object({
    id: identifierSchema,
    family: z.enum(['hostile', 'benign']),
    expectedStatus: z.number().int().min(100).max(599),
    actualStatus: z.number().int().min(100).max(599),
    expectedFlagVisible: z.boolean(),
    actualFlagVisible: z.boolean(),
    passed: z.boolean(),
  })
  .strict();

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'must be a SHA-256 hex digest');

export const evaluationEvidenceSchema = z
  .object({
    id: identifierSchema,
    episodeId: identifierSchema,
    candidateId: defenseCandidateSchema,
    targetVersion: z.literal('v2'),
    candidateDigest: sha256Schema,
    cases: z.array(evaluationCaseSchema).length(6),
    hostilePassed: z.literal(3),
    benignPassed: z.literal(3),
    falsePositiveRate: z.literal(0),
    createdAt: z.iso.datetime({ offset: true }),
    digest: sha256Schema,
  })
  .strict();

export const redMethodMemorySchema = z
  .object({
    attempts: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    score: z.number().finite(),
  })
  .strict();

export const whiteMemorySchema = z
  .object({
    episodeId: identifierSchema.optional(),
    candidateId: defenseCandidateSchema.optional(),
    evidenceId: identifierSchema.optional(),
  })
  .strict();

export const episodeStatusSchema = z.enum(['idle', 'running', 'complete', 'failed']);

export const arenaStateViewSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    episode: z
      .object({
        id: identifierSchema,
        status: episodeStatusSchema,
        currentTurn: turnSchema,
      })
      .strict()
      .nullable(),
    activeVersion: targetVersionSchema,
    events: z.array(arenaEventSchema),
    redMemory: z.record(attackMethodSchema, redMethodMemorySchema),
    whiteMemory: whiteMemorySchema,
    evidence: z.array(evaluationEvidenceSchema),
    metrics: z
      .object({
        redFlags: z.number().int().nonnegative(),
        whiteSaves: z.number().int().nonnegative(),
        policyBreaches: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const credentialCaseSchema = z.enum(['invalid', 'empty', 'valid_admin', 'valid_viewer']);
export const loginScenarioInputSchema = z
  .object({
    credentialCase: credentialCaseSchema,
    requestedRole: z.enum(['viewer', 'admin']).nullable(),
  })
  .strict();

export const loginResultSchema = z
  .object({
    status: z.number().int().min(100).max(599),
    authenticated: z.boolean(),
    role: z.enum(['viewer', 'admin']).nullable(),
    flagVisible: z.boolean(),
    responseLabel: z.string().trim().min(1).max(120),
  })
  .strict();

export const targetHealthSchema = z
  .object({
    status: z.enum(['healthy', 'unhealthy']),
    version: targetVersionSchema,
  })
  .strict();

const attemptReference = {
  episode_id: identifierSchema,
  attempt_id: identifierSchema,
};

export const mapSurfaceInputSchema = z
  .object({ ...attemptReference, surface: z.literal('login') })
  .strict();
export const submitAttackInputSchema = z
  .object({
    ...attemptReference,
    scenario: attackScenarioSchema,
    replay: z.boolean().default(false),
  })
  .strict();
export const readEpisodeInputSchema = z.object(attemptReference).strict();
export const shadowTestInputSchema = z
  .object({ ...attemptReference, candidate_id: defenseCandidateSchema })
  .strict();
export const submitEvidenceInputSchema = z
  .object({ ...attemptReference, evidence_id: identifierSchema })
  .strict();
export const promoteCandidateInputSchema = z
  .object({
    ...attemptReference,
    candidate_id: defenseCandidateSchema,
    evidence_id: identifierSchema,
  })
  .strict();
export const targetHealthInputSchema = z.object(attemptReference).strict();

export const mapSurfaceOutputSchema = z
  .object({
    surface: z.literal('login'),
    fields: z.array(z.enum(['email', 'password', 'requestedRole'])).min(1),
  })
  .strict();
export const attackResultSchema = z
  .object({
    attempt_id: identifierSchema,
    target_version: targetVersionSchema,
    status: z.number().int().min(100).max(599),
    flag_captured: z.boolean(),
    replay: z.boolean(),
    invariant_violated: z.boolean(),
  })
  .strict();
export const readEpisodeOutputSchema = z
  .object({
    episode_id: identifierSchema,
    invariant: z.literal('unauthenticated_must_not_become_admin'),
    candidate_id: defenseCandidateSchema.optional(),
    evidence_id: identifierSchema.optional(),
  })
  .strict();
export const shadowTestOutputSchema = z
  .object({ candidate_id: defenseCandidateSchema, evidence: evaluationEvidenceSchema })
  .strict();
export const submitEvidenceOutputSchema = z
  .object({ evidence_id: identifierSchema, digest: sha256Schema, accepted: z.boolean() })
  .strict();
export const promotionResultSchema = z
  .object({
    candidate_id: defenseCandidateSchema,
    evidence_id: identifierSchema,
    active_version: z.literal('v2'),
    deployed: z.boolean(),
    idempotent: z.boolean(),
  })
  .strict();
export const targetHealthOutputSchema = z
  .object({
    active_version: targetVersionSchema,
    targets: z.object({ v1: targetHealthSchema, v2: targetHealthSchema }).strict(),
  })
  .strict();

export const toolInputSchemas = {
  arena_map_surface: mapSurfaceInputSchema,
  arena_submit_attack: submitAttackInputSchema,
  arena_read_episode: readEpisodeInputSchema,
  arena_shadow_test: shadowTestInputSchema,
  arena_submit_evidence: submitEvidenceInputSchema,
  arena_promote_candidate: promoteCandidateInputSchema,
  arena_target_health: targetHealthInputSchema,
} as const;

export const toolOutputSchemas = {
  arena_map_surface: mapSurfaceOutputSchema,
  arena_submit_attack: attackResultSchema,
  arena_read_episode: readEpisodeOutputSchema,
  arena_shadow_test: shadowTestOutputSchema,
  arena_submit_evidence: submitEvidenceOutputSchema,
  arena_promote_candidate: promotionResultSchema,
  arena_target_health: targetHealthOutputSchema,
} as const;

export const episodeRefSchema = z.object({ episode_id: identifierSchema }).strict();
export const redMapResultSchema = z
  .object({
    surface: mapSurfaceOutputSchema,
    method_scores: z.record(attackMethodSchema, z.number().finite()),
  })
  .strict();
export const redAttackRequestSchema = submitAttackInputSchema;
export const whiteRemediationResultSchema = z
  .object({
    candidate_id: defenseCandidateSchema,
    promotion_denied: z.boolean(),
    evidence_id: identifierSchema,
  })
  .strict();
export const whiteLearnRequestSchema = z
  .object({ episode_id: identifierSchema, evidence_id: identifierSchema })
  .strict();
export const promotionRequestSchema = promoteCandidateInputSchema;

export const serviceNameSchema = z.enum([
  'arena',
  'target-v1',
  'target-v2',
  'red-agent',
  'white-agent',
  'deploy-controller',
  'pomerium-log-bridge',
]);
export const healthResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: serviceNameSchema,
    version: z.string().trim().min(1).max(32),
  })
  .strict();
export const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: identifierSchema,
        message: z.string().trim().min(1).max(240),
        retriable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const pomeriumIngestionSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    episode_id: identifierSchema,
    attempt_id: identifierSchema,
    request_id: identifierSchema,
    identity: z.string().trim().min(1).max(160),
    mcp_method: z.literal('tools/call'),
    mcp_tool: toolNameSchema,
    decision: z.enum(['allow', 'deny']),
    reason: z.string().trim().min(1).max(240),
    received_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const contractFixtureSchema = z
  .object({
    fixtureLabel: z.literal('SYNTHETIC CONTRACT FIXTURE'),
    schemaVersion: schemaVersionSchema,
    events: z.array(arenaEventSchema),
    edgeCaseEvents: z.array(arenaEventSchema),
  })
  .strict();
