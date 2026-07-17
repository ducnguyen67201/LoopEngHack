export type DemoMode = 'fake' | 'recorded' | 'live' | 'hybrid';
export type LoopPhase =
  'sense' | 'plan' | 'request' | 'authorize' | 'execute' | 'observe' | 'learn';
export type EventStatus = 'started' | 'allowed' | 'denied' | 'completed' | 'failed';

export interface GameEvent {
  schemaVersion: number;
  id: string;
  episodeId: string;
  sequence: number;
  turn: number;
  occurredAt: string;
  actor: string;
  kind: string;
  phase: LoopPhase;
  source: string;
  status: EventStatus;
  summary: string;
  visualCue?: string;
  payload?: Record<string, unknown>;
  proof?: Record<string, unknown>;
}

export interface PresentationState {
  mode: DemoMode;
  connection: string;
  episodeId: string;
  episodeStatus: string;
  lastSequence: number;
  turn: number;
  phase: LoopPhase;
  currentSummary: string;
  outcome: string;
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
