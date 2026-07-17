import {
  createEpisode,
  FixtureEventSource,
  LiveEventSource,
  loadEpisodeSnapshot,
  readLaunchOptions,
} from './replay.js';

export const KNOWN_EVENT_KINDS = new Set([
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
  'regression_stored',
  'screen_scheduled',
  'replay_result',
  'memory_updated',
  'episode_completed',
  'inner_episode_completed',
  'learning_episode_completed',
  'loop_closure_requested',
  'manual_voice_attack',
  'loop_completed',
  'error',
]);

const PHASES = new Set(['sense', 'plan', 'request', 'authorize', 'execute', 'observe', 'learn']);
const SOURCE_LABELS = {
  'agent-loop': 'LOOP ENGINE',
  zero: 'ZERO',
  pomerium: 'POMERIUM',
  fillmore: 'FILLMORE',
};

export function createInitialPresentationState(mode = 'fake') {
  return {
    mode,
    connection: mode === 'live' ? 'connecting' : 'fixture-ready',
    episodeId: 'not-started',
    episodeStatus: 'idle',
    objective: 'Verify one candidate and schedule one sandbox screen',
    readiness: {
      score: 0,
      threshold: 75,
      hostileEvaluations: 0,
      legitimateControls: 0,
      mutationCoverage: 0,
    },
    lastSequence: 0,
    turn: 0,
    phase: 'sense',
    currentSummary: 'Press play to run the recruiting loop',
    outcome: 'WAITING FOR FIRST EVENT',
    unknownEvents: 0,
    gap: null,
    red: {
      sprite: 'idle',
      technique: 'No technique selected',
      score: 0,
      memory: ['No attempts observed'],
    },
    candidate: {
      id: 'candidate-pending',
      displayName: 'Unknown recruit',
      headline: 'Awaiting enrichment',
      location: '—',
      profile: 'Synthetic profiles only',
      avatar: 'infrastructureEngineer',
      message: 'No candidate content observed yet.',
      status: 'unverified',
    },
    researcher: {
      sprite: 'idle',
      diagnosis: 'Waiting for an observable failure',
      memory: ['No regression stored'],
      evidence: [],
    },
    gate: {
      state: 'ready',
      identity: '—',
      tool: 'recruiting_schedule_screen',
      reason: 'Identity-aware policy is standing by',
    },
    zero: {
      state: 'ready',
      capability: 'Not selected',
      budgetRemaining: 3,
    },
    fillmore: {
      state: 'waiting',
      pipeline: 'Not created',
    },
    calendar: {
      state: 'locked',
      title: 'No screening event',
    },
    sourceStatus: {
      'agent-loop': 'ready',
      zero: 'ready',
      pomerium: 'ready',
      fillmore: 'ready',
    },
    metrics: {
      redFlags: 0,
      whiteSaves: 0,
      policyBreaches: 0,
    },
    proof: {},
    trace: [],
    timeline: [],
  };
}

export function validateGameEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return 'Event must be an object';
  }

  for (const field of ['id', 'episodeId', 'actor', 'kind', 'summary', 'visualCue']) {
    if (typeof event[field] !== 'string' || event[field].trim() === '') {
      return `Event field ${field} must be a non-empty string`;
    }
  }

  if (event.schemaVersion !== 1) {
    return 'Event schemaVersion must be 1';
  }

  if (!Number.isInteger(event.sequence) || event.sequence < 1) {
    return 'Event sequence must be a positive integer';
  }

  if (!Number.isInteger(event.turn) || event.turn < 0 || event.turn > 8) {
    return 'Event turn must be an integer from 0 through 8';
  }

  if (!PHASES.has(event.phase)) {
    return `Unrecognized loop phase: ${String(event.phase)}`;
  }

  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    return 'Event payload must be an object';
  }

  if (typeof event.occurredAt !== 'string' || Number.isNaN(Date.parse(event.occurredAt))) {
    return 'Event occurredAt must be an ISO timestamp';
  }

  return null;
}

function appendEvidence(evidence, item) {
  if (!item || evidence.some((existing) => existing.id === item.id)) {
    return evidence;
  }
  return [...evidence, item];
}

function sourceForEvent(event) {
  if (event.kind === 'manual_voice_attack') {
    return event.source === 'agent-loop' ? 'agent-loop' : 'pomerium';
  }
  if (event.kind === 'policy_decision') return 'pomerium';
  if (['zero_capability_discovered', 'verification_completed'].includes(event.kind)) return 'zero';
  if (
    [
      'role_created',
      'candidate_sourced',
      'outreach_sent',
      'screen_recommended',
      'screen_scheduled',
    ].includes(event.kind)
  ) {
    return 'fillmore';
  }
  return 'agent-loop';
}

function statusForEvent(event) {
  if (event.kind === 'error') return 'failed';
  if (event.kind === 'tool_requested' || event.kind === 'episode_started') return 'started';
  if (event.kind === 'policy_decision') {
    return event.payload.decision === 'allow' ? 'allowed' : 'denied';
  }
  if (event.kind === 'replay_result' && event.payload.blocked === true) return 'denied';
  if (event.kind === 'manual_voice_attack') return 'denied';
  return 'completed';
}

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function proofForEvent(event) {
  const payload = event.payload;
  const authorization = recordValue(payload.authorization);
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  const firstArtifact = recordValue(artifacts[0]);
  const artifactMetadata = recordValue(firstArtifact.metadata);
  const proof = {};

  const requestId = payload.requestId ?? authorization.requestId;
  if (event.kind === 'policy_decision' && typeof requestId === 'string') {
    const key = payload.decision === 'allow' ? 'pomeriumAllowRequestId' : 'pomeriumDenyRequestId';
    proof[key] = requestId;
  }
  if (event.kind === 'zero_capability_discovered' && typeof payload.capabilityId === 'string') {
    proof.zeroCapabilityId = payload.capabilityId;
  }
  if (event.kind === 'verification_completed') {
    const invocationId = payload.invocationId ?? artifactMetadata.invocationId;
    const digest = payload.artifactSha256 ?? firstArtifact.digest;
    if (typeof invocationId === 'string') proof.zeroInvocationId = invocationId;
    if (typeof digest === 'string') proof.evidenceHash = digest;
  }
  if (event.kind === 'evidence_submitted' && typeof payload.digest === 'string') {
    proof.evidenceHash = payload.digest;
  }
  if (event.kind === 'screen_scheduled') {
    const operationId = payload.calendarEventId ?? firstArtifact.id;
    if (typeof operationId === 'string') proof.fillmoreOperationId = operationId;
  }
  if (event.observationId) proof.observationId = event.observationId;
  return proof;
}

function withTrace(state, event, recognized, source, status) {
  const entry = {
    id: event.id,
    sequence: event.sequence,
    turn: event.turn,
    source,
    status,
    kind: event.kind,
    summary: event.summary,
    recognized,
  };

  return [...state.trace, entry].slice(-40);
}

export function reducePresentation(state, event) {
  const validationError = validateGameEvent(event);
  if (validationError) {
    return {
      ...state,
      connection: 'error',
      currentSummary: validationError,
      outcome: 'INVALID EVENT — STREAM PAUSED',
    };
  }

  if (event.sequence <= state.lastSequence) {
    return state;
  }

  const expectedSequence = state.lastSequence + 1;
  if (event.sequence !== expectedSequence) {
    return {
      ...state,
      connection: 'gap',
      gap: { expected: expectedSequence, received: event.sequence },
      currentSummary: `Sequence gap: expected ${expectedSequence}, received ${event.sequence}`,
      outcome: 'SNAPSHOT REQUIRED',
    };
  }

  const recognized = KNOWN_EVENT_KINDS.has(event.kind);
  const payload = event.payload;
  const source = sourceForEvent(event);
  const status = statusForEvent(event);
  const proof = proofForEvent(event);
  let next = {
    ...state,
    episodeId: event.episodeId,
    episodeStatus:
      event.kind === 'episode_completed' || event.kind === 'loop_completed'
        ? 'complete'
        : event.kind === 'loop_closure_requested'
          ? 'awaiting_human'
          : 'running',
    connection: state.mode === 'live' ? 'live' : 'fixture-ready',
    gap: null,
    lastSequence: event.sequence,
    turn: event.turn,
    phase: event.phase,
    currentSummary: event.summary,
    unknownEvents: state.unknownEvents + (recognized ? 0 : 1),
    sourceStatus: {
      ...state.sourceStatus,
      [source]: status,
    },
    proof: { ...state.proof, ...proof },
    trace: withTrace(state, event, recognized, source, status),
    timeline: [
      ...state.timeline,
      {
        sequence: event.sequence,
        turn: event.turn,
        kind: event.kind,
        status,
      },
    ],
  };

  switch (event.kind) {
    case 'episode_started':
      next = {
        ...next,
        objective: payload.objective ?? state.objective,
        zero: {
          ...state.zero,
          budgetRemaining: payload.zeroBudget ?? state.zero.budgetRemaining,
        },
        outcome: 'SANDBOX READY',
      };
      break;
    case 'role_created':
      next = {
        ...next,
        fillmore: {
          state: 'pipeline-ready',
          pipeline: payload.roleId ?? 'Synthetic recruiting pipeline',
        },
        outcome: 'PIPELINE ONLINE',
      };
      break;
    case 'candidate_sourced':
      next = {
        ...next,
        candidate: {
          ...state.candidate,
          displayName: 'Synthetic candidate set',
          headline: 'Hostile and legitimate controls sourced',
          status: 'sourced',
        },
        fillmore: { ...state.fillmore, state: 'candidates-sourced' },
        outcome: 'CANDIDATES SOURCED',
      };
      break;
    case 'outreach_sent':
      next = {
        ...next,
        candidate: { ...state.candidate, status: 'contacted' },
        fillmore: { ...state.fillmore, state: 'outreach-sent' },
        outcome: 'CONTROLLED OUTREACH SENT',
      };
      break;
    case 'attack_selected':
      next = {
        ...next,
        red: {
          ...state.red,
          sprite: 'bluffing',
          technique: payload.technique ?? 'Unknown technique',
          score: payload.redScore ?? payload.score ?? state.red.score,
        },
        outcome: 'ATTACK SELECTED',
      };
      break;
    case 'candidate_replied':
      next = {
        ...next,
        red: { ...state.red, sprite: 'messaging' },
        candidate: {
          ...state.candidate,
          message: event.summary,
          status: 'claim-received',
        },
        outcome: 'PERSUASION ATTEMPT',
      };
      break;
    case 'screen_recommended':
      next = {
        ...next,
        red: { ...state.red, sprite: 'bluffing' },
        candidate: { ...state.candidate, status: 'recommended-without-evidence' },
        outcome: 'UNVERIFIED SCREEN RECOMMENDED',
      };
      break;
    case 'tool_requested':
      next = {
        ...next,
        red: { ...state.red, sprite: 'bluffing' },
        gate: {
          state: 'pending',
          identity: event.actor,
          tool: payload.tool ?? state.gate.tool,
          reason: 'Authorization request in flight',
        },
        outcome: 'PRIVILEGED TOOL REQUESTED',
      };
      break;
    case 'policy_decision': {
      const allowed = payload.decision === 'allow';
      next = {
        ...next,
        red: allowed ? state.red : { ...state.red, sprite: 'blocked' },
        gate: {
          state: allowed ? 'allowed' : 'denied',
          identity: event.actor,
          tool: payload.tool ?? state.gate.tool,
          reason: event.summary,
        },
        calendar: { ...state.calendar, state: allowed ? 'unlocked' : 'locked' },
        metrics: {
          ...state.metrics,
          redFlags: state.metrics.redFlags + (allowed ? 0 : 1),
        },
        outcome: allowed ? 'CONTROLLER ALLOWED — SAME TOOL' : 'POMERIUM DENIED — NO SIDE EFFECT',
      };
      break;
    }
    case 'failure_invariant_stored':
      next = {
        ...next,
        researcher: {
          ...state.researcher,
          sprite: 'searching',
          diagnosis: payload.invariant ?? event.summary,
          evidence: appendEvidence(state.researcher.evidence, {
            id: `missing-${event.id}`,
            label: 'Independent evidence required',
            status: 'missing',
          }),
        },
        outcome: 'DEFENSE DIAGNOSES FAILURE',
      };
      break;
    case 'defense_selected':
      next = {
        ...next,
        researcher: { ...state.researcher, sprite: 'searching' },
        zero: {
          ...state.zero,
          state: 'discovering',
          capability: payload.need ?? 'Searching capability catalog…',
        },
        outcome: 'ZERO DISCOVERING TOOL',
      };
      break;
    case 'zero_capability_discovered':
      next = {
        ...next,
        researcher: { ...state.researcher, sprite: 'verifying' },
        zero: {
          state: 'activated',
          capability: payload.capabilityLabel ?? payload.capabilityId ?? 'Verification capability',
          budgetRemaining: payload.zeroBudgetRemaining ?? state.zero.budgetRemaining,
        },
        outcome: 'VERIFICATION TOOL ACTIVATED',
      };
      break;
    case 'verification_completed':
      next = {
        ...next,
        researcher: {
          ...state.researcher,
          sprite: 'verifying',
          diagnosis: event.summary,
          evidence: appendEvidence(state.researcher.evidence, {
            id: event.observationId ?? event.id,
            label: 'Independent verification completed',
            status: 'verified',
          }),
        },
        candidate: { ...state.candidate, status: 'claim-mismatch' },
        outcome: 'CLAIM MISMATCH FOUND',
      };
      break;
    case 'regression_stored':
      next = {
        ...next,
        researcher: {
          ...state.researcher,
          sprite: 'success',
          memory: [
            `Stored regression ${payload.regressionId ?? 'for independent evidence'}`,
            ...state.researcher.memory,
          ].slice(0, 3),
        },
        outcome: 'DEFENSE MEMORY UPDATED',
      };
      break;
    case 'evidence_submitted':
      next = {
        ...next,
        candidate: {
          ...state.candidate,
          displayName: 'Synthetic control candidate',
          message: 'Evidence supplied. Ready for a sandbox screen.',
          status: 'verified-for-screen',
        },
        researcher: {
          ...state.researcher,
          sprite: 'success',
          evidence: appendEvidence(state.researcher.evidence, {
            id: payload.evidenceId ?? event.id,
            label: 'Digest-bound scheduling evidence',
            status: 'verified',
          }),
        },
        outcome: 'LEGITIMATE CANDIDATE VERIFIED',
      };
      break;
    case 'screen_scheduled':
      next = {
        ...next,
        fillmore: { ...state.fillmore, state: payload.fillmoreState ?? 'scheduled' },
        candidate: {
          ...state.candidate,
          status: payload.candidateStatus ?? 'verified-for-screen',
        },
        calendar: {
          state: 'scheduled',
          title: payload.calendarTitle ?? '[HACKATHON TEST] Screening',
        },
        metrics: { ...state.metrics, whiteSaves: state.metrics.whiteSaves + 1 },
        outcome: 'FILLMORE BOOKED TEST SCREEN ✓',
      };
      break;
    case 'replay_result':
      next = {
        ...next,
        red: {
          ...state.red,
          sprite: payload.blocked === true ? 'blocked' : 'bluffing',
          score: payload.redScore ?? state.red.score,
          memory: [
            payload.blocked === true
              ? `Replay blocked by ${payload.matchedRule ?? 'stored regression'}`
              : 'Replay bypassed stored regression',
            ...state.red.memory,
          ].slice(0, 3),
        },
        candidate: {
          ...state.candidate,
          message: payload.mutation ?? state.candidate.message,
        },
        outcome: payload.blocked === true ? 'MUTATED REPLAY BLOCKED' : 'REPLAY BYPASSED DEFENSE',
      };
      break;
    case 'manual_voice_attack':
      next = {
        ...next,
        episodeStatus: state.episodeStatus,
        red: {
          ...state.red,
          sprite: 'blocked',
          technique: payload.technique ?? 'voice_authority_spoof',
          memory: ['Live voice attack blocked', ...state.red.memory].slice(0, 3),
        },
        candidate: {
          ...state.candidate,
          message: `${payload.channel === 'elevenlabs' ? 'ELEVENLABS PHONE TRANSCRIPT' : 'CALL TRANSCRIPT'}: “${payload.transcript ?? event.summary}”`,
          status: 'claim-mismatch',
        },
        researcher: {
          ...state.researcher,
          sprite: 'success',
          diagnosis: 'Caller speech is untrusted content, not approval evidence.',
          memory: [
            `Stored live-call regression: ${payload.learnedInvariant ?? 'voice cannot authorize screening'}`,
            ...state.researcher.memory,
          ].slice(0, 3),
        },
        gate: {
          ...state.gate,
          state: 'denied',
          identity: 'live-operator-call',
          reason: 'Untrusted caller speech cannot authorize recruiting_schedule_screen.',
        },
        metrics: {
          ...state.metrics,
          redFlags: state.metrics.redFlags + 1,
          whiteSaves: state.metrics.whiteSaves + 1,
        },
        outcome: 'LIVE CALL ATTACK CAUGHT • REGRESSION LEARNED',
      };
      break;
    case 'inner_episode_completed':
      next = {
        ...next,
        episodeStatus: 'running',
        outcome: 'EPISODE COMPLETE — EVALUATING STOP CONDITION',
      };
      break;
    case 'learning_episode_completed':
      next = {
        ...next,
        episodeStatus: 'running',
        readiness: {
          ...state.readiness,
          score: payload.readinessScore ?? state.readiness.score,
          hostileEvaluations: payload.hostileEvaluations ?? state.readiness.hostileEvaluations,
          legitimateControls: payload.legitimateControls ?? state.readiness.legitimateControls,
          mutationCoverage: payload.mutationCoverage ?? state.readiness.mutationCoverage,
        },
        outcome: `READINESS ${payload.readinessScore ?? state.readiness.score}% — LOOP CONTINUES`,
      };
      break;
    case 'loop_closure_requested':
      next = {
        ...next,
        episodeStatus: 'awaiting_human',
        outcome: 'AWAITING YOUR PHONE RESPONSE',
      };
      break;
    case 'loop_completed':
      next = {
        ...next,
        episodeStatus: 'complete',
        readiness: {
          ...state.readiness,
          score: payload.readinessScore ?? state.readiness.score,
          hostileEvaluations: payload.hostileEvaluations ?? state.readiness.hostileEvaluations,
          legitimateControls: payload.legitimateControls ?? state.readiness.legitimateControls,
        },
        metrics: {
          ...state.metrics,
          policyBreaches: payload.policyBreaches ?? state.metrics.policyBreaches,
        },
        outcome: `FULL LOOP COMPLETE — READINESS ${payload.readinessScore ?? state.readiness.score}%`,
      };
      break;
    case 'memory_updated':
      next = {
        ...next,
        red: {
          ...state.red,
          score: payload.redScore ?? state.red.score,
          memory: ['Red memory updated', ...state.red.memory].slice(0, 3),
        },
        researcher: {
          ...state.researcher,
          sprite: 'success',
          memory: [
            `White retained regression ${payload.regressionId ?? 'memory'}`,
            ...state.researcher.memory,
          ].slice(0, 3),
        },
        outcome: 'BOTH AGENTS LEARNED',
      };
      break;
    case 'episode_completed':
      next = {
        ...next,
        episodeStatus: 'complete',
        researcher: { ...state.researcher, sprite: 'success' },
        metrics: {
          redFlags: payload.redFlags ?? state.metrics.redFlags,
          whiteSaves: payload.whiteSaves ?? state.metrics.whiteSaves,
          policyBreaches: payload.policyBreaches ?? state.metrics.policyBreaches,
        },
        outcome: 'LOOP COMPLETE — CONTAINED • VERIFIED • LEARNED',
      };
      break;
    case 'error':
      next = {
        ...next,
        episodeStatus: 'failed',
        connection: 'error',
        outcome: 'EPISODE STOPPED SAFELY',
      };
      break;
    default:
      next = {
        ...next,
        outcome: `UNRECOGNIZED EVENT — ${event.kind}`,
      };
  }

  return next;
}

export function replayEvents(events, mode = 'fake') {
  return events.reduce(
    (state, event) => reducePresentation(state, event),
    createInitialPresentationState(mode),
  );
}

export async function recoverPresentationSnapshot(episodeId, fetcher = globalThis.fetch) {
  const snapshot = await loadEpisodeSnapshot(episodeId, fetcher);
  const state = replayEvents(snapshot.events, 'live');
  if (state.gap !== null || state.lastSequence !== snapshot.lastSequence) {
    throw new Error('Authoritative episode snapshot contains a sequence gap');
  }
  return { events: snapshot.events, state };
}

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required UI element #${id}`);
  }
  return element;
}

function setText(id, value) {
  requireElement(id).textContent = String(value);
}

function setState(id, value) {
  requireElement(id).dataset.state = value;
}

function percentage(value) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}

function spritePaths(manifest, state) {
  const recruitProfiles = manifest.syntheticRecruits?.profiles ?? {};
  return {
    red: manifest.actors?.redSocialEngineer?.states?.[state.red.sprite],
    researcher: manifest.actors?.whiteResearcher?.states?.[state.researcher.sprite],
    recruit: recruitProfiles[state.candidate.avatar] ?? recruitProfiles.infrastructureEngineer,
  };
}

function renderList(id, items, fallback) {
  const list = requireElement(id);
  list.replaceChildren();
  const values = items.length > 0 ? items : [fallback];
  for (const value of values) {
    const item = document.createElement('li');
    item.textContent = value;
    list.append(item);
  }
}

function renderEvidence(evidence) {
  const list = requireElement('evidence-list');
  list.replaceChildren();
  if (evidence.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-row';
    empty.textContent = 'No evidence assembled';
    list.append(empty);
    return;
  }

  for (const item of evidence.slice(-3)) {
    const row = document.createElement('li');
    row.dataset.state = item.status;
    const marker = document.createElement('span');
    marker.className = 'evidence-marker';
    marker.textContent = item.status === 'verified' ? '✓' : '?';
    const label = document.createElement('span');
    label.textContent = item.label;
    row.append(marker, label);
    list.append(row);
  }
}

function renderTrace(trace) {
  const list = requireElement('event-trace');
  list.replaceChildren();
  for (const entry of trace.slice(-7).reverse()) {
    const item = document.createElement('li');
    item.dataset.source = entry.source;
    item.dataset.status = entry.status;
    if (!entry.recognized) item.dataset.recognized = 'false';

    const sequence = document.createElement('span');
    sequence.className = 'trace-sequence';
    sequence.textContent = String(entry.sequence).padStart(2, '0');
    const source = document.createElement('span');
    source.className = 'trace-source';
    source.textContent = SOURCE_LABELS[entry.source] ?? entry.source.toUpperCase();
    const summary = document.createElement('span');
    summary.className = 'trace-summary';
    summary.textContent = entry.summary;
    item.append(sequence, source, summary);
    list.append(item);
  }
}

function renderProof(proof) {
  const list = requireElement('proof-list');
  list.replaceChildren();
  const entries = Object.entries(proof);
  if (entries.length === 0) {
    const row = document.createElement('div');
    row.className = 'proof-row';
    row.textContent = 'Proof IDs appear as sponsor calls complete.';
    list.append(row);
    return;
  }

  for (const [key, value] of entries) {
    const row = document.createElement('div');
    row.className = 'proof-row';
    const term = document.createElement('dt');
    term.textContent = key;
    const description = document.createElement('dd');
    description.textContent = String(value);
    row.append(term, description);
    list.append(row);
  }
}

function renderTimeline(events, state, onSelect, disabled) {
  const rail = requireElement('turn-rail');
  if (rail.childElementCount !== events.length) {
    rail.replaceChildren();
    for (const event of events) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'turn-chip';
      button.dataset.sequence = String(event.sequence);
      button.setAttribute('aria-label', `Replay through event ${event.sequence}: ${event.summary}`);
      const sequence = document.createElement('span');
      sequence.textContent = String(event.sequence).padStart(2, '0');
      const label = document.createElement('strong');
      label.textContent = event.kind.replaceAll('_', ' ');
      button.append(sequence, label);
      button.addEventListener('click', () => onSelect(event.sequence));
      rail.append(button);
    }
  }

  for (const button of rail.querySelectorAll('button')) {
    const sequence = Number(button.dataset.sequence);
    button.disabled = disabled;
    button.dataset.state =
      sequence === state.lastSequence
        ? 'current'
        : sequence < state.lastSequence
          ? 'complete'
          : 'pending';
  }
}

function renderSourceStatus(sourceStatus) {
  for (const [source, status] of Object.entries(sourceStatus)) {
    const element = document.querySelector(`[data-source-health="${source}"]`);
    if (element) {
      element.dataset.state = status;
      element.querySelector('strong').textContent = status.toUpperCase();
    }
  }
}

function render(state, manifest, events, handlers) {
  const sprites = spritePaths(manifest, state);
  requireElement('red-sprite').src = sprites.red;
  requireElement('researcher-sprite').src = sprites.researcher;
  requireElement('recruit-sprite').src = sprites.recruit;

  setText('mode-badge', state.mode.toUpperCase());
  setState('mode-badge', state.mode);
  setText('connection-label', state.connection.replace('-', ' ').toUpperCase());
  setState('connection-label', state.connection);
  setText('episode-objective', state.objective);
  setText('turn-value', `${state.turn} / 8`);
  setText('phase-value', state.phase.toUpperCase());
  setText('readiness-value', `${state.readiness.score}%`);
  setText('outcome-banner', state.outcome);
  setState('outcome-banner', state.gate.state);

  setText('technique-value', state.red.technique);
  setText('red-score', percentage(state.red.score));
  requireElement('red-score-bar').style.width = percentage(state.red.score);
  renderList('red-memory', state.red.memory, 'No red memory');

  setText('candidate-name', state.candidate.displayName);
  setText('candidate-headline', state.candidate.headline);
  setText('candidate-location', state.candidate.location);
  setText('candidate-profile', state.candidate.profile);
  setText('candidate-message', state.candidate.message);
  setText('candidate-status', state.candidate.status.replaceAll('-', ' ').toUpperCase());
  setState('candidate-status', state.candidate.status);

  setText('gate-state', state.gate.state.toUpperCase());
  setText('gate-identity', state.gate.identity);
  setText('gate-tool', state.gate.tool);
  setText('gate-reason', state.gate.reason);
  setState('pomerium-gate', state.gate.state);

  setText('calendar-state', state.calendar.state.toUpperCase());
  setText('calendar-title', state.calendar.title);
  setState('calendar-card', state.calendar.state);

  setText('diagnosis-value', state.researcher.diagnosis);
  setText('zero-state', state.zero.state.toUpperCase());
  setText('zero-capability', state.zero.capability);
  setText('zero-budget', String(state.zero.budgetRemaining));
  setText('fillmore-state', state.fillmore.state.toUpperCase());
  renderList('white-memory', state.researcher.memory, 'No white memory');
  renderEvidence(state.researcher.evidence);

  setText('red-flags', state.metrics.redFlags);
  setText('white-saves', state.metrics.whiteSaves);
  setText('policy-breaches', state.metrics.policyBreaches);
  setText('live-status', state.currentSummary);
  renderSourceStatus(state.sourceStatus);
  renderTrace(state.trace);
  renderProof(state.proof);
  renderTimeline(events, state, handlers.select, state.mode === 'live');
  document.body.dataset.gate = state.gate.state;
  document.body.dataset.episode = state.episodeStatus;
}

async function loadManifest() {
  const response = await fetch('/assets/sprites/manifest.json', {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Sprite manifest request failed with ${response.status}`);
  return response.json();
}

async function bootstrap() {
  const options = readLaunchOptions();
  const manifest = await loadManifest();
  let state = createInitialPresentationState(options.mode);
  let events = [];
  let pointer = -1;
  let timer = null;
  let liveSource = null;
  let liveEpisodeId = options.episodeId;
  let recoveryPromise = null;

  const playButton = requireElement('play-button');
  const nextButton = requireElement('next-button');
  const restartButton = requireElement('restart-button');
  const speedSelect = requireElement('speed-select');
  const proofDialog = requireElement('proof-dialog');
  const callDialog = requireElement('call-dialog');
  const callTranscript = requireElement('manual-call-transcript');
  const callFeedback = requireElement('call-feedback');
  const submitCallButton = requireElement('submit-call-button');

  const handlers = {
    select(sequence) {
      if (state.mode === 'live') return;
      pointer = events.findIndex((event) => event.sequence === sequence);
      state = replayEvents(events.slice(0, pointer + 1), state.mode);
      render(state, manifest, events, handlers);
    },
  };

  function pause() {
    if (timer !== null) globalThis.clearInterval(timer);
    timer = null;
    playButton.textContent = 'PLAY';
    playButton.setAttribute('aria-pressed', 'false');
  }

  function recoverFromSnapshot() {
    if (recoveryPromise !== null || !liveEpisodeId) return;

    liveSource?.close();
    state = { ...state, connection: 'recovering' };
    render(state, manifest, events, handlers);
    recoveryPromise = recoverPresentationSnapshot(liveEpisodeId)
      .then((recovered) => {
        events = [...recovered.events];
        state = { ...recovered.state, connection: 'recovered' };
        render(state, manifest, events, handlers);
        if (state.episodeStatus === 'complete' || state.episodeStatus === 'failed') {
          pause();
          liveSource?.close();
        } else {
          liveSource?.connect(state.lastSequence);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Snapshot recovery failed';
        state = { ...state, connection: 'error', currentSummary: message };
        render(state, manifest, events, handlers);
      })
      .finally(() => {
        recoveryPromise = null;
      });
  }

  function applyEvent(event) {
    const priorSequence = state.lastSequence;
    state = reducePresentation(state, event);

    if (state.lastSequence > priorSequence && !events.some(({ id }) => id === event.id)) {
      events = [...events, event];
    }

    if (state.connection === 'gap' && state.lastSequence === priorSequence) {
      pause();
      recoverFromSnapshot();
    }

    render(state, manifest, events, handlers);
    if (state.episodeStatus === 'complete' || state.episodeStatus === 'failed') {
      pause();
      liveSource?.close();
    }
  }

  function next() {
    if (pointer >= events.length - 1) {
      pause();
      return;
    }
    pointer += 1;
    applyEvent(events[pointer]);
  }

  function play() {
    if (state.mode === 'live' || timer !== null) return;
    if (pointer >= events.length - 1) {
      pointer = -1;
      state = createInitialPresentationState(state.mode);
    }
    const interval = Number(speedSelect.value);
    timer = globalThis.setInterval(next, interval);
    playButton.textContent = 'PAUSE';
    playButton.setAttribute('aria-pressed', 'true');
    next();
  }

  playButton.addEventListener('click', () => (timer === null ? play() : pause()));
  nextButton.addEventListener('click', () => {
    pause();
    next();
  });
  restartButton.addEventListener('click', () => {
    pause();
    if (state.mode === 'live') return;
    pointer = -1;
    state = createInitialPresentationState(state.mode);
    render(state, manifest, events, handlers);
  });
  speedSelect.addEventListener('change', () => {
    if (timer !== null) {
      pause();
      play();
    }
  });
  requireElement('show-proof-button').addEventListener('click', () => proofDialog.showModal());
  requireElement('close-proof-button').addEventListener('click', () => proofDialog.close());
  requireElement('open-call-button').addEventListener('click', () => callDialog.showModal());
  requireElement('close-call-button').addEventListener('click', () => callDialog.close());
  for (const preset of document.querySelectorAll('[data-call-preset]')) {
    preset.addEventListener('click', () => {
      callTranscript.value = preset.dataset.callPreset ?? callTranscript.value;
      callTranscript.focus();
    });
  }
  submitCallButton.addEventListener('click', async (submitEvent) => {
    submitEvent.preventDefault();
    if (!liveEpisodeId) {
      callFeedback.dataset.state = 'error';
      callFeedback.textContent = 'Start the live demo before simulating the call.';
      return;
    }
    submitCallButton.disabled = true;
    callFeedback.dataset.state = '';
    callFeedback.textContent = 'Evaluating caller speech against the learned policy…';
    try {
      const response = await fetch(
        `/api/episodes/${encodeURIComponent(liveEpisodeId)}/manual-voice-attack`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: callTranscript.value }),
        },
      );
      if (!response.ok) throw new Error(`Call simulation failed with ${response.status}`);
      const body = await response.json();
      applyEvent(body.event);
      callFeedback.dataset.state = 'caught';
      callFeedback.textContent =
        'CAUGHT — denied with no side effect and stored as a new regression.';
    } catch (error) {
      callFeedback.dataset.state = 'error';
      callFeedback.textContent = error instanceof Error ? error.message : 'Call simulation failed.';
    } finally {
      submitCallButton.disabled = false;
    }
  });

  if (options.mode === 'live') {
    playButton.disabled = true;
    nextButton.disabled = true;
    restartButton.disabled = true;
    if (!liveEpisodeId) {
      state = { ...state, connection: 'starting-episode' };
      render(state, manifest, events, handlers);
      const started = await createEpisode();
      liveEpisodeId = started.episodeId;
      const url = new URL(globalThis.location.href);
      url.searchParams.set('mode', 'live');
      url.searchParams.set('episode', liveEpisodeId);
      globalThis.history.replaceState({}, '', url);
    }

    // INTEGRATION(agent-loop): the loop coordinator publishes normalized GameEvent objects to
    // the server EventSink. The browser must never call Zero, Pomerium, Fillmore, or an agent.
    // INTEGRATION(zero-adapter): the coordinator publishes zero_capability_discovered and
    // verification_completed after the injected ZeroPort returns sanitized observations.
    // INTEGRATION(pomerium-adapter): the injected PolicyPort contributes safe authorization
    // metadata to canonical policy_decision events; credentials never reach this client.
    // INTEGRATION(recruiting-adapter): the injected RecruitingOpsPort contributes only sanitized
    // role/candidate/screen artifacts to canonical engine events.
    liveSource = new LiveEventSource({
      episodeId: liveEpisodeId,
      onEvent: applyEvent,
      onConnection(connection) {
        state = { ...state, connection };
        render(state, manifest, events, handlers);
      },
      onError(error) {
        state = { ...state, connection: 'error', currentSummary: error.message };
        render(state, manifest, events, handlers);
      },
    });
    globalThis.addEventListener('beforeunload', () => liveSource.close());
    liveSource.connect();
  } else {
    const fixture = await new FixtureEventSource().load();
    events = fixture.events;
    render(state, manifest, events, handlers);
    if (options.autoplay) play();
  }
}

if (typeof document !== 'undefined') {
  bootstrap().catch((error) => {
    const message = error instanceof Error ? error.message : 'Unable to start the demo';
    const status = document.getElementById('live-status');
    if (status) status.textContent = message;
    const outcome = document.getElementById('outcome-banner');
    if (outcome) outcome.textContent = `DEMO STARTUP ERROR — ${message}`;
    console.error(error);
  });
}
