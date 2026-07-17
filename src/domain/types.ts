import type { z } from 'zod';

import type {
  arenaEventSchema,
  arenaStateViewSchema,
  attackMethodSchema,
  attackResultSchema,
  contractFixtureSchema,
  episodeRefSchema,
  errorEnvelopeSchema,
  evaluationEvidenceSchema,
  healthResponseSchema,
  loginResultSchema,
  loginScenarioInputSchema,
  pomeriumIngestionSchema,
  promotionRequestSchema,
  promotionResultSchema,
  redAttackRequestSchema,
  redMapResultSchema,
  serviceNameSchema,
  targetHealthSchema,
  targetVersionSchema,
  toolInputSchemas,
  toolNameSchema,
  toolOutputSchemas,
  whiteLearnRequestSchema,
  whiteMemorySchema,
  whiteRemediationResultSchema,
} from './schemas.js';

export type ArenaEvent = z.infer<typeof arenaEventSchema>;
export type ArenaEventDraft = Omit<ArenaEvent, 'id' | 'sequence' | 'occurredAt'>;
export type ArenaStateView = z.infer<typeof arenaStateViewSchema>;
export type AttackMethod = z.infer<typeof attackMethodSchema>;
export type AttackResult = z.infer<typeof attackResultSchema>;
export type ContractFixture = z.infer<typeof contractFixtureSchema>;
export type EpisodeRef = z.infer<typeof episodeRefSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type EvaluationEvidence = z.infer<typeof evaluationEvidenceSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type LoginResult = z.infer<typeof loginResultSchema>;
export type LoginScenarioInput = z.infer<typeof loginScenarioInputSchema>;
export type PomeriumIngestion = z.infer<typeof pomeriumIngestionSchema>;
export type PromotionRequest = z.infer<typeof promotionRequestSchema>;
export type PromotionResult = z.infer<typeof promotionResultSchema>;
export type RedAttackRequest = z.infer<typeof redAttackRequestSchema>;
export type RedMapResult = z.infer<typeof redMapResultSchema>;
export type ServiceName = z.infer<typeof serviceNameSchema>;
export type TargetHealth = z.infer<typeof targetHealthSchema>;
export type TargetVersion = z.infer<typeof targetVersionSchema>;
export type ToolName = z.infer<typeof toolNameSchema>;
export type WhiteLearnRequest = z.infer<typeof whiteLearnRequestSchema>;
export type WhiteMemory = z.infer<typeof whiteMemorySchema>;
export type WhiteRemediationResult = z.infer<typeof whiteRemediationResultSchema>;

export type ToolInputMap = {
  [Name in ToolName]: z.infer<(typeof toolInputSchemas)[Name]>;
};

export type ToolOutputMap = {
  [Name in ToolName]: z.infer<(typeof toolOutputSchemas)[Name]>;
};
