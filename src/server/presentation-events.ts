import { createHash } from 'node:crypto';

import type { EventSink } from '../domain/ports.js';
import type { GameEvent, RedTechnique } from '../domain/types.js';
import type { LearningLoopResult, LoopReadiness } from '../loop/contracts.js';

export type PresentationEventKind =
  | GameEvent['kind']
  | 'inner_episode_completed'
  | 'learning_episode_completed'
  | 'loop_closure_requested'
  | 'loop_completed';

export interface PresentationEvent {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly episodeId: string;
  readonly sequence: number;
  readonly turn: GameEvent['turn'];
  readonly occurredAt: string;
  readonly actor: string;
  readonly kind: PresentationEventKind;
  readonly phase: GameEvent['phase'];
  readonly source: 'agent-loop' | 'zero' | 'pomerium' | 'fillmore';
  readonly status: 'started' | 'allowed' | 'denied' | 'completed' | 'failed';
  readonly summary: string;
  readonly visualCue: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly proof: Readonly<Record<string, string | number>>;
}

type Subscriber = (event: PresentationEvent) => void;

export class PresentationEventHub implements EventSink {
  private readonly historyValue: PresentationEvent[] = [];
  private readonly pending: PresentationEvent[] = [];
  private readonly subscribers = new Set<Subscriber>();
  private nextSequence = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly runId: string,
    private readonly stepDelayMs = 0,
  ) {
    if (!Number.isInteger(stepDelayMs) || stepDelayMs < 0 || stepDelayMs > 10_000) {
      throw new RangeError('Presentation step delay must be between 0 and 10000 milliseconds');
    }
  }

  append(event: GameEvent): void {
    this.enqueue(mapDomainEvent(this.runId, this.reserveSequence(), event));
  }

  publishProgress(readiness: LoopReadiness, attackFamily: RedTechnique): void {
    this.enqueue(
      this.synthetic('learning_episode_completed', 'learn', 'completed', {
        attackFamily,
        readinessScore: readiness.score,
        containmentRate: readiness.containmentRate,
        legitimatePassRate: readiness.legitimatePassRate,
        mutationCoverage: readiness.mutationCoverage,
        evidenceCompleteness: readiness.evidenceCompleteness,
        hostileEvaluations: readiness.hostileEvaluations,
        legitimateControls: readiness.legitimateControls,
      }),
    );
  }

  publishTerminal(result: LearningLoopResult): void {
    this.enqueue(
      this.synthetic(
        result.status === 'complete' ? 'loop_completed' : 'error',
        'learn',
        result.status === 'complete' ? 'completed' : 'failed',
        {
          readinessScore: result.readiness.score,
          readinessThresholdReached: result.status === 'complete',
          reason: result.reason,
          hostileEvaluations: result.readiness.hostileEvaluations,
          legitimateControls: result.readiness.legitimateControls,
          attackFamiliesCovered: result.readiness.attackFamiliesCovered,
          policyBreaches: result.readiness.unauthorizedActions,
        },
      ),
    );
  }

  publishClosureRequested(conversationId: string): void {
    this.enqueue(
      this.synthetic('loop_closure_requested', 'learn', 'started', {
        conversationId,
      }),
    );
  }

  publishFailure(reason: string): void {
    this.enqueue(
      this.synthetic('error', 'learn', 'failed', {
        reason,
        policyBreaches: 0,
      }),
    );
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  since(sequence: number): PresentationEvent[] {
    return this.historyValue
      .filter((event) => event.sequence > sequence)
      .map((event) => structuredClone(event));
  }

  get history(): readonly PresentationEvent[] {
    return this.historyValue.map((event) => structuredClone(event));
  }

  private synthetic(
    kind: Extract<
      PresentationEventKind,
      'learning_episode_completed' | 'loop_closure_requested' | 'loop_completed' | 'error'
    >,
    phase: GameEvent['phase'],
    status: PresentationEvent['status'],
    payload: Readonly<Record<string, unknown>>,
  ): PresentationEvent {
    const sequence = this.reserveSequence();
    const summary =
      kind === 'loop_completed'
        ? `Learning loop converged at readiness ${String(payload.readinessScore)}`
        : kind === 'error'
          ? `Learning loop stopped safely: ${String(payload.reason)}`
          : kind === 'loop_closure_requested'
            ? 'Learning finished; waiting for the operator phone response'
            : `Episode evaluated at readiness ${String(payload.readinessScore)}`;
    return {
      schemaVersion: 1,
      id: `stream-${this.runId}-${sequence}`,
      episodeId: this.runId,
      sequence,
      turn: 8,
      occurredAt: new Date().toISOString(),
      actor: 'arena',
      kind,
      phase,
      source: 'agent-loop',
      status,
      summary,
      visualCue:
        kind === 'error'
          ? 'error'
          : kind === 'loop_closure_requested'
            ? 'arena.phone'
            : 'arena.complete',
      payload,
      proof: { eventHash: eventDigest(this.runId, sequence, kind, payload) },
    };
  }

  private publish(event: PresentationEvent): void {
    this.historyValue.push(structuredClone(event));
    for (const subscriber of this.subscribers) subscriber(structuredClone(event));
  }

  private enqueue(event: PresentationEvent): void {
    if (this.stepDelayMs === 0) {
      this.publish(event);
      return;
    }
    this.pending.push(event);
    this.startPump();
  }

  private reserveSequence(): number {
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    return sequence;
  }

  private startPump(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const event = this.pending.shift();
      if (event !== undefined) this.publish(event);
      if (this.pending.length > 0) this.startPump();
    }, this.stepDelayMs);
  }
}

function mapDomainEvent(runId: string, sequence: number, event: GameEvent): PresentationEvent {
  const kind = mapKind(event);
  const status = mapStatus(event);
  const payload = { ...event.payload, innerEpisodeId: event.episodeId };
  return {
    schemaVersion: 1,
    id: `stream-${runId}-${sequence}`,
    episodeId: runId,
    sequence,
    turn: event.turn,
    occurredAt: event.occurredAt,
    actor: event.actor,
    kind,
    phase: event.phase,
    source: eventSource(event),
    status,
    summary: event.summary,
    visualCue: event.visualCue,
    payload,
    proof: eventProof(event, runId, sequence),
  };
}

function mapKind(event: GameEvent): PresentationEventKind {
  if (event.kind === 'episode_completed') return 'inner_episode_completed';
  return event.kind;
}

function mapStatus(event: GameEvent): PresentationEvent['status'] {
  if (event.kind === 'error') return 'failed';
  if (event.kind === 'policy_decision') {
    return event.payload.decision === 'deny' ? 'denied' : 'allowed';
  }
  if (event.phase === 'sense' || event.phase === 'plan' || event.phase === 'request') {
    return 'started';
  }
  return 'completed';
}

function eventSource(event: GameEvent): PresentationEvent['source'] {
  if (event.kind === 'policy_decision') return 'pomerium';
  if (event.kind.startsWith('zero_') || event.kind === 'verification_completed') return 'zero';
  if (
    event.kind === 'role_created' ||
    event.kind === 'candidate_sourced' ||
    event.kind === 'outreach_sent' ||
    event.kind === 'screen_scheduled'
  ) {
    return 'fillmore';
  }
  return 'agent-loop';
}

function eventProof(
  event: GameEvent,
  runId: string,
  sequence: number,
): Readonly<Record<string, string | number>> {
  const proof: Record<string, string | number> = {
    eventHash: eventDigest(runId, sequence, event.kind, event.payload),
  };
  copyProof(event.payload, proof, 'requestId', 'pomeriumRequestId');
  copyProof(event.payload, proof, 'capabilityId', 'zeroCapabilityId');
  copyProof(event.payload, proof, 'invocationId', 'zeroInvocationId');
  copyProof(event.payload, proof, 'artifactDigest', 'evidenceHash');
  copyProof(event.payload, proof, 'digest', 'evidenceHash');
  copyProof(event.payload, proof, 'operationId', 'fillmoreOperationId');
  return proof;
}

function copyProof(
  payload: Readonly<Record<string, unknown>>,
  proof: Record<string, string | number>,
  source: string,
  target: string,
): void {
  const value = payload[source];
  if (typeof value === 'string' || typeof value === 'number') proof[target] = value;
}

function eventDigest(
  runId: string,
  sequence: number,
  kind: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify({ runId, sequence, kind, payload }))
    .digest('hex')}`;
}
