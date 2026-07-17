import { z } from 'zod';

import {
  identifierSchema,
  schemaVersionSchema,
  syntheticCandidateSchema,
  syntheticRoleBriefSchema,
} from '../../domain/schemas.js';

const operationResponseBase = {
  schemaVersion: schemaVersionSchema,
  operationId: identifierSchema,
};

const idempotentOperationResponseBase = {
  ...operationResponseBase,
  replayed: z.boolean(),
};

export const outboundAllowlistSchema = z
  .object({
    roleIds: z.array(identifierSchema).min(1).max(32),
    candidateIds: z.array(identifierSchema).min(1).max(128),
    templateIds: z.array(identifierSchema).min(1).max(32),
    eventIds: z.array(identifierSchema).min(1).max(128),
    sandboxIds: z.array(identifierSchema).min(1).max(32),
    sandboxCalendarIds: z.array(identifierSchema).min(1).max(32),
  })
  .strict();

export interface OutboundRecruitingAllowlist {
  readonly roleIds: readonly string[];
  readonly candidateIds: readonly string[];
  readonly templateIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly sandboxIds: readonly string[];
  readonly sandboxCalendarIds: readonly string[];
}

export const createRoleRequestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    episodeId: identifierSchema,
    attemptId: identifierSchema,
    role: syntheticRoleBriefSchema,
  })
  .strict();

export const createRoleResponseSchema = z
  .object({
    ...idempotentOperationResponseBase,
    roleId: identifierSchema,
    sandboxId: identifierSchema,
  })
  .strict();

const outboundCandidateReferenceSchema = syntheticCandidateSchema.omit({ label: true }).strict();

export const sourceCandidatesRequestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    episodeId: identifierSchema,
    attemptId: identifierSchema,
    roleId: identifierSchema,
    candidates: z.array(outboundCandidateReferenceSchema).min(1).max(4),
  })
  .strict();

export const sourceCandidatesResponseSchema = z
  .object({
    ...idempotentOperationResponseBase,
    roleId: identifierSchema,
    candidateIds: z.array(identifierSchema).min(1).max(4),
  })
  .strict();

export const sendOutreachRequestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    episodeId: identifierSchema,
    attemptId: identifierSchema,
    roleId: identifierSchema,
    candidateId: identifierSchema,
    templateId: identifierSchema,
  })
  .strict();

export const sendOutreachResponseSchema = z
  .object({
    ...idempotentOperationResponseBase,
    messageId: identifierSchema,
    candidateId: identifierSchema,
    templateId: identifierSchema,
  })
  .strict();

export const readCandidateEventRequestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    episodeId: identifierSchema,
    attemptId: identifierSchema,
    candidateId: identifierSchema,
    eventId: identifierSchema,
  })
  .strict();

export const candidateEventSignalCodeSchema = z.enum([
  'candidate_authority_claim',
  'candidate_urgency_claim',
  'portfolio_instruction',
  'credential_mismatch',
]);

export const readCandidateEventResponseSchema = z
  .object({
    ...operationResponseBase,
    eventId: identifierSchema,
    candidateId: identifierSchema,
    eventType: z.literal('candidate_reply'),
    screenRecommended: z.boolean(),
    independentEvidencePresent: z.boolean(),
    signalCodes: z.array(candidateEventSignalCodeSchema).max(4),
  })
  .strict();

export const scheduleScreenRequestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    episodeId: identifierSchema,
    attemptId: identifierSchema,
    candidateId: identifierSchema,
    roleId: identifierSchema,
    evidenceId: identifierSchema,
    sandboxCalendarId: identifierSchema,
  })
  .strict();

export const scheduleScreenResponseSchema = z
  .object({
    ...idempotentOperationResponseBase,
    calendarEventId: identifierSchema,
    candidateId: identifierSchema,
    roleId: identifierSchema,
    sandboxCalendarId: identifierSchema,
  })
  .strict();

export type CandidateEventSignalCode = z.infer<typeof candidateEventSignalCodeSchema>;
