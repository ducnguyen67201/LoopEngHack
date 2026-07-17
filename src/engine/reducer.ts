import { redTechniqueSchema, recruitingGameStateSchema } from '../domain/schemas.js';
import type {
  ActionAttempt,
  DiscoveredCapability,
  GameEvent,
  LoopPhase,
  PipelineStage,
  RecruitingGameState,
  RegressionRule,
  SyntheticCandidate,
  SyntheticRoleBrief,
  VerificationEvidence,
  WhiteMemory,
} from '../domain/types.js';

const emptyMethodMemory = () => ({
  attempts: 0,
  screeningWins: 0,
  privilegedActionWins: 0,
  detections: 0,
  successReward: 0,
  novelty: 1,
  bypassDepth: 0,
  detectionPenalty: 0,
  cost: 0,
  score: 1,
  lastMutation: null,
});

export function createInitialState(): RecruitingGameState {
  const techniques = redTechniqueSchema.options;
  return recruitingGameStateSchema.parse({
    schemaVersion: 1,
    episode: null,
    roleBrief: null,
    candidates: {},
    pipeline: {},
    pendingAction: null,
    evidence: {},
    regressions: [],
    redMemory: Object.fromEntries(techniques.map((technique) => [technique, emptyMethodMemory()])),
    whiteMemory: {
      observedSignals: [],
      defenseIds: [],
      regressionIds: [],
      canonicalEvidenceHashes: [],
      falsePositiveCount: 0,
    },
    zeroCapabilities: [],
    metrics: {
      manipulationAttempts: 0,
      detectionMisses: 0,
      pomeriumDenials: 0,
      verifiedCandidates: 0,
      testScreensScheduled: 0,
      unauthorizedActions: 0,
      falsePositives: 0,
      zeroSpendUsd: 0,
    },
    adapterFailures: {},
    events: [],
    nextSequence: 1,
  });
}

type MetricName = keyof RecruitingGameState['metrics'];

export type StateMutation =
  | { type: 'start_episode'; episodeId: string }
  | { type: 'set_position'; turn: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; phase: LoopPhase }
  | { type: 'set_role'; role: SyntheticRoleBrief }
  | { type: 'source_candidates'; candidates: SyntheticCandidate[] }
  | { type: 'set_pipeline_stage'; candidateId: string; stage: PipelineStage }
  | { type: 'set_pending_action'; action: ActionAttempt | null }
  | { type: 'add_evidence'; evidence: VerificationEvidence }
  | { type: 'add_regression'; regression: RegressionRule }
  | { type: 'add_capability'; capability: DiscoveredCapability }
  | { type: 'set_white_memory'; memory: WhiteMemory }
  | { type: 'set_red_memory'; memory: RecruitingGameState['redMemory'] }
  | { type: 'increment_metric'; metric: MetricName; amount: number }
  | { type: 'record_adapter_failure'; key: string }
  | { type: 'append_event'; event: GameEvent }
  | { type: 'complete_episode' }
  | { type: 'fail_episode' };

export function reduceState(
  state: RecruitingGameState,
  mutation: StateMutation,
): RecruitingGameState {
  switch (mutation.type) {
    case 'start_episode':
      return {
        ...state,
        episode: {
          id: mutation.episodeId,
          status: 'running',
          currentTurn: 0,
          currentPhase: 'sense',
        },
      };
    case 'set_position':
      if (state.episode === null) throw new Error('cannot advance an episode that has not started');
      return {
        ...state,
        episode: {
          ...state.episode,
          currentTurn: mutation.turn,
          currentPhase: mutation.phase,
        },
      };
    case 'set_role':
      return { ...state, roleBrief: mutation.role };
    case 'source_candidates':
      return {
        ...state,
        candidates: {
          ...state.candidates,
          ...Object.fromEntries(mutation.candidates.map((candidate) => [candidate.id, candidate])),
        },
        pipeline: {
          ...state.pipeline,
          ...Object.fromEntries(mutation.candidates.map((candidate) => [candidate.id, 'sourced'])),
        },
      };
    case 'set_pipeline_stage':
      return {
        ...state,
        pipeline: { ...state.pipeline, [mutation.candidateId]: mutation.stage },
      };
    case 'set_pending_action':
      return { ...state, pendingAction: mutation.action };
    case 'add_evidence':
      return {
        ...state,
        evidence: { ...state.evidence, [mutation.evidence.id]: mutation.evidence },
      };
    case 'add_regression':
      return { ...state, regressions: [...state.regressions, mutation.regression] };
    case 'add_capability':
      return { ...state, zeroCapabilities: [...state.zeroCapabilities, mutation.capability] };
    case 'set_white_memory':
      return { ...state, whiteMemory: mutation.memory };
    case 'set_red_memory':
      return { ...state, redMemory: mutation.memory };
    case 'increment_metric':
      return {
        ...state,
        metrics: {
          ...state.metrics,
          [mutation.metric]: state.metrics[mutation.metric] + mutation.amount,
        },
      };
    case 'record_adapter_failure':
      return {
        ...state,
        adapterFailures: {
          ...state.adapterFailures,
          [mutation.key]: (state.adapterFailures[mutation.key] ?? 0) + 1,
        },
      };
    case 'append_event': {
      if (mutation.event.sequence !== state.nextSequence) {
        throw new Error(
          `out-of-order event sequence: expected ${state.nextSequence}, got ${mutation.event.sequence}`,
        );
      }
      if (state.events.some((event) => event.id === mutation.event.id)) {
        throw new Error(`duplicate event id: ${mutation.event.id}`);
      }
      return {
        ...state,
        events: [...state.events, mutation.event],
        nextSequence: state.nextSequence + 1,
      };
    }
    case 'complete_episode':
      if (state.episode === null)
        throw new Error('cannot complete an episode that has not started');
      return { ...state, episode: { ...state.episode, status: 'complete' } };
    case 'fail_episode':
      if (state.episode === null) throw new Error('cannot fail an episode that has not started');
      return { ...state, episode: { ...state.episode, status: 'failed' } };
  }
}
