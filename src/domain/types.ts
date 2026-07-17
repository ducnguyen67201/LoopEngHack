import type { z } from 'zod';
import type {
  actionAttemptSchema,
  actorIdSchema,
  artifactReferenceSchema,
  authorizationDecisionSchema,
  authorizeToolCommandSchema,
  createRoleCommandSchema,
  discoveredCapabilitySchema,
  discoverCapabilityCommandSchema,
  errorCategorySchema,
  eventKindSchema,
  executionContextSchema,
  factSchema,
  gameEventSchema,
  healthResponseSchema,
  invokeCapabilityCommandSchema,
  loopPhaseSchema,
  methodMemorySchema,
  observationSchema,
  pipelineStageSchema,
  provenanceSchema,
  readCandidateEventCommandSchema,
  recruitingContractFixtureSchema,
  recruitingGameStateSchema,
  redTechniqueSchema,
  regressionRuleSchema,
  riskSignalSchema,
  scheduleScreenCommandSchema,
  sendOutreachCommandSchema,
  serviceNameSchema,
  sourceCandidatesCommandSchema,
  syntheticCandidateSchema,
  syntheticRoleBriefSchema,
  toolNameSchema,
  verificationEvidenceSchema,
  verificationNeedSchema,
  visualCueSchema,
  whiteMemorySchema,
} from './schemas.js';

export type ActionAttempt = z.infer<typeof actionAttemptSchema>;
export type ActorId = z.infer<typeof actorIdSchema>;
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;
export type AuthorizationDecision = z.infer<typeof authorizationDecisionSchema>;
export type AuthorizeToolCommand = z.infer<typeof authorizeToolCommandSchema>;
export type CreateRoleCommand = z.infer<typeof createRoleCommandSchema>;
export type DiscoveredCapability = z.infer<typeof discoveredCapabilitySchema>;
export type DiscoverCapabilityCommand = z.infer<typeof discoverCapabilityCommandSchema>;
export type ErrorCategory = z.infer<typeof errorCategorySchema>;
export type EventKind = z.infer<typeof eventKindSchema>;
export type ExecutionContext = z.infer<typeof executionContextSchema>;
export type Fact = z.infer<typeof factSchema>;
export type GameEvent = z.infer<typeof gameEventSchema>;
export type GameEventDraft = Omit<GameEvent, 'id' | 'sequence' | 'occurredAt'>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type InvokeCapabilityCommand = z.infer<typeof invokeCapabilityCommandSchema>;
export type LoopPhase = z.infer<typeof loopPhaseSchema>;
export type MethodMemory = z.infer<typeof methodMemorySchema>;
export type Observation = z.infer<typeof observationSchema>;
export type PipelineStage = z.infer<typeof pipelineStageSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type ReadCandidateEventCommand = z.infer<typeof readCandidateEventCommandSchema>;
export type RecruitingContractFixture = z.infer<typeof recruitingContractFixtureSchema>;
export type RecruitingGameState = z.infer<typeof recruitingGameStateSchema>;
export type RedTechnique = z.infer<typeof redTechniqueSchema>;
export type RegressionRule = z.infer<typeof regressionRuleSchema>;
export type RiskSignal = z.infer<typeof riskSignalSchema>;
export type ScheduleScreenCommand = z.infer<typeof scheduleScreenCommandSchema>;
export type SendOutreachCommand = z.infer<typeof sendOutreachCommandSchema>;
export type ServiceName = z.infer<typeof serviceNameSchema>;
export type SourceCandidatesCommand = z.infer<typeof sourceCandidatesCommandSchema>;
export type SyntheticCandidate = z.infer<typeof syntheticCandidateSchema>;
export type SyntheticRoleBrief = z.infer<typeof syntheticRoleBriefSchema>;
export type ToolName = z.infer<typeof toolNameSchema>;
export type VerificationEvidence = z.infer<typeof verificationEvidenceSchema>;
export type VerificationNeed = z.infer<typeof verificationNeedSchema>;
export type VisualCue = z.infer<typeof visualCueSchema>;
export type WhiteMemory = z.infer<typeof whiteMemorySchema>;
