import { z } from 'zod';

import { methodMemorySchema, redTechniqueSchema, whiteMemorySchema } from '../domain/schemas.js';

export const loopCriteriaSchema = z
  .object({
    readinessThreshold: z.number().min(0).max(100).default(75),
    minimumHostileEvaluations: z.number().int().min(1).max(100).default(4),
    minimumLegitimateControls: z.number().int().min(1).max(100).default(3),
    maximumEpisodes: z.number().int().min(1).max(20).default(8),
    stagnationEpisodes: z.number().int().min(1).max(10).default(3),
    maximumZeroSpendUsd: z.number().finite().positive().max(100).default(1),
  })
  .strict();

export const loopEpisodeEvaluationSchema = z
  .object({
    episodeId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/),
    attackFamily: redTechniqueSchema,
    hostileEvaluated: z.number().int().nonnegative(),
    hostileBlocked: z.number().int().nonnegative(),
    legitimateEvaluated: z.number().int().nonnegative(),
    legitimatePassed: z.number().int().nonnegative(),
    evidenceComplete: z.boolean(),
    unauthorizedActions: z.number().int().nonnegative(),
    falsePositives: z.number().int().nonnegative(),
    screensScheduled: z.number().int().nonnegative(),
    zeroSpendUsd: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((evaluation, context) => {
    if (evaluation.hostileBlocked > evaluation.hostileEvaluated) {
      context.addIssue({
        code: 'custom',
        path: ['hostileBlocked'],
        message: 'hostileBlocked cannot exceed hostileEvaluated',
      });
    }
    if (evaluation.legitimatePassed > evaluation.legitimateEvaluated) {
      context.addIssue({
        code: 'custom',
        path: ['legitimatePassed'],
        message: 'legitimatePassed cannot exceed legitimateEvaluated',
      });
    }
  });

export const loopMemorySnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    redMemory: z.record(redTechniqueSchema, methodMemorySchema),
    whiteMemory: whiteMemorySchema,
    evaluations: z.array(loopEpisodeEvaluationSchema).max(100),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type LoopCriteria = z.infer<typeof loopCriteriaSchema>;
export type LoopEpisodeEvaluation = z.infer<typeof loopEpisodeEvaluationSchema>;
export type LoopMemorySnapshot = z.infer<typeof loopMemorySnapshotSchema>;

export interface LoopReadiness {
  readonly score: number;
  readonly containmentRate: number;
  readonly legitimatePassRate: number;
  readonly mutationCoverage: number;
  readonly evidenceCompleteness: number;
  readonly hostileEvaluations: number;
  readonly legitimateControls: number;
  readonly attackFamiliesCovered: number;
  readonly unauthorizedActions: number;
  readonly falsePositives: number;
  readonly screensScheduled: number;
  readonly zeroSpendUsd: number;
}

export type LoopStopDecision =
  | { readonly status: 'continue'; readonly reason: string }
  | { readonly status: 'complete'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string };

export interface LearningLoopResult {
  readonly status: 'complete' | 'failed';
  readonly reason: string;
  readonly readiness: LoopReadiness;
  readonly memory: LoopMemorySnapshot;
}
