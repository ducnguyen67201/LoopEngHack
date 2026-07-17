import type {
  ActorId,
  GameEvent as DomainGameEvent,
  LoopPhase as DomainLoopPhase,
} from '../src/domain/types.js';

export type DemoMode = 'fake' | 'recorded' | 'live' | 'hybrid';
export type LoopPhase = DomainLoopPhase;
export type EventStatus = 'started' | 'allowed' | 'denied' | 'completed' | 'failed';
export interface GameEvent extends Omit<
  DomainGameEvent,
  'actor' | 'kind' | 'payload' | 'visualCue'
> {
  actor: ActorId | string;
  kind:
    | DomainGameEvent['kind']
    | 'inner_episode_completed'
    | 'learning_episode_completed'
    | 'loop_closure_requested'
    | 'loop_completed';
  payload: Readonly<Record<string, unknown>>;
  visualCue: string;
  source?: 'agent-loop' | 'zero' | 'pomerium' | 'fillmore';
  status?: EventStatus;
  proof?: Readonly<Record<string, string | number>>;
}

export interface PresentationState {
  mode: DemoMode;
  connection: string;
  episodeId: string;
  episodeStatus: string;
  lastSequence: number;
  turn: number;
  phase: LoopPhase;
  objective: string;
  currentSummary: string;
  outcome: string;
  readiness: {
    score: number;
    threshold: number;
    hostileEvaluations: number;
    legitimateControls: number;
    mutationCoverage: number;
  };
  unknownEvents: number;
  gap: { expected: number; received: number } | null;
  red: {
    sprite: string;
    technique: string;
    score: number;
    memory: string[];
  };
  candidate: {
    id: string;
    displayName: string;
    headline: string;
    location: string;
    profile: string;
    avatar: string;
    message: string;
    status: string;
  };
  researcher: {
    sprite: string;
    diagnosis: string;
    memory: string[];
    evidence: Array<{ id: string; label: string; status: string }>;
  };
  gate: {
    state: string;
    identity: string;
    tool: string;
    reason: string;
  };
  zero: {
    state: string;
    capability: string;
    budgetRemaining: number;
  };
  fillmore: {
    state: string;
    pipeline: string;
  };
  calendar: {
    state: string;
    title: string;
  };
  metrics: {
    redFlags: number;
    whiteSaves: number;
    policyBreaches: number;
  };
  sourceStatus: Record<'agent-loop' | 'zero' | 'pomerium' | 'fillmore', string>;
  proof: Record<string, unknown>;
  trace: Array<{
    id: string;
    sequence: number;
    source: string;
    status: string;
    kind: string;
    summary: string;
    recognized: boolean;
  }>;
  timeline: Array<{ sequence: number; turn: number; kind: string; status: string }>;
}

export const KNOWN_EVENT_KINDS: Set<string>;
export function createInitialPresentationState(mode?: DemoMode): PresentationState;
export function validateGameEvent(event: unknown): string | null;
export function reducePresentation(state: PresentationState, event: GameEvent): PresentationState;
export function replayEvents(events: GameEvent[], mode?: DemoMode): PresentationState;
export function recoverPresentationSnapshot(
  episodeId: string,
  fetcher?: typeof fetch,
): Promise<{ events: GameEvent[]; state: PresentationState }>;
