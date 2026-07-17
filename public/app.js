import { FixtureEventSource, LiveEventSource, readLaunchOptions } from './replay.js';

export const KNOWN_EVENT_KINDS = new Set([
  'episode_initialized',
  'pipeline_created',
  'candidate_enriched',
  'candidate_attack_emitted',
  'schedule_requested',
  'policy_denied',
  'verification_started',
  'zero_discovery_started',
  'zero_discovery_completed',
  'evidence_created',
  'regression_stored',
  'legitimate_candidate_verified',
  'policy_allowed',
  'screen_scheduled',
  'replay_blocked',
  'memory_updated',
  'episode_completed',
  'error',
]);

const PHASES = new Set(['sense', 'plan', 'request', 'authorize', 'execute', 'observe', 'learn']);
const STATUSES = new Set(['started', 'allowed', 'denied', 'completed', 'failed']);
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
    lastSequence: -1,
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
      tool: 'fillmore_schedule_screen',
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

  for (const field of ['id', 'episodeId', 'actor', 'kind', 'source', 'status', 'summary']) {
    if (typeof event[field] !== 'string' || event[field].trim() === '') {
      return `Event field ${field} must be a non-empty string`;
    }
  }

  if (!Number.isInteger(event.sequence) || event.sequence < 0) {
    return 'Event sequence must be a non-negative integer';
  }

  if (!Number.isInteger(event.turn) || event.turn < 0 || event.turn > 8) {
    return 'Event turn must be an integer from 0 through 8';
  }

  if (!PHASES.has(event.phase)) {
    return `Unrecognized loop phase: ${String(event.phase)}`;
  }

  if (!STATUSES.has(event.status)) {
    return `Unrecognized event status: ${event.status}`;
  }

  if (event.payload !== undefined && (!event.payload || typeof event.payload !== 'object')) {
    return 'Event payload must be an object when present';
  }

  return null;
}

function appendEvidence(evidence, item) {
  if (!item || evidence.some((existing) => existing.id === item.id)) {
    return evidence;
  }
  return [...evidence, item];
}

function withTrace(state, event, recognized) {
  const entry = {
    id: event.id,
    sequence: event.sequence,
    turn: event.turn,
    source: event.source,
    status: event.status,
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
  const payload = event.payload ?? {};
  const proof = event.proof ?? {};
  let next = {
    ...state,
    episodeId: event.episodeId,
    episodeStatus: event.kind === 'episode_completed' ? 'complete' : 'running',
    connection: state.mode === 'live' ? 'live' : 'fixture-ready',
    gap: null,
    lastSequence: event.sequence,
    turn: event.turn,
    phase: event.phase,
    currentSummary: event.summary,
    unknownEvents: state.unknownEvents + (recognized ? 0 : 1),
    sourceStatus: {
      ...state.sourceStatus,
      [event.source]: event.status,
    },
    proof: { ...state.proof, ...proof },
    trace: withTrace(state, event, recognized),
    timeline: [
      ...state.timeline,
      {
        sequence: event.sequence,
        turn: event.turn,
        kind: event.kind,
        status: event.status,
      },
    ],
  };

  switch (event.kind) {
    case 'episode_initialized':
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
    case 'pipeline_created':
      next = {
        ...next,
        fillmore: {
          state: 'pipeline-ready',
          pipeline: payload.pipelineName ?? 'Synthetic recruiting pipeline',
        },
        outcome: 'PIPELINE ONLINE',
      };
      break;
    case 'candidate_enriched': {
      const candidate = payload.candidate ?? {};
      next = {
        ...next,
        candidate: {
          ...state.candidate,
          ...candidate,
          status: 'enriched',
        },
        researcher: { ...state.researcher, sprite: 'searching' },
        zero: {
          ...state.zero,
          state: 'profile-enriched',
          capability: 'Public profile enrichment',
          budgetRemaining: payload.zeroBudgetRemaining ?? state.zero.budgetRemaining,
        },
        outcome: 'PROFILE ENRICHED',
      };
      break;
    }
    case 'candidate_attack_emitted':
      next = {
        ...next,
        red: {
          ...state.red,
          sprite: 'messaging',
          technique: payload.technique ?? 'Unknown technique',
          score: payload.redScore ?? state.red.score,
        },
        candidate: {
          ...state.candidate,
          message: payload.message ?? event.summary,
          status: 'claim-received',
        },
        outcome: 'PERSUASION ATTEMPT',
      };
      break;
    case 'schedule_requested':
      next = {
        ...next,
        red: { ...state.red, sprite: 'bluffing' },
        gate: {
          state: 'pending',
          identity: payload.identity ?? 'unknown-identity',
          tool: payload.tool ?? state.gate.tool,
          reason: 'Authorization request in flight',
        },
        outcome: 'PRIVILEGED TOOL REQUESTED',
      };
      break;
    case 'policy_denied':
      next = {
        ...next,
        red: { ...state.red, sprite: 'blocked' },
        gate: {
          state: 'denied',
          identity: payload.identity ?? state.gate.identity,
          tool: payload.tool ?? state.gate.tool,
          reason: payload.reason ?? event.summary,
        },
        calendar: { ...state.calendar, state: 'locked' },
        metrics: { ...state.metrics, redFlags: state.metrics.redFlags + 1 },
        outcome: 'POMERIUM DENIED — NO SIDE EFFECT',
      };
      break;
    case 'verification_started':
      next = {
        ...next,
        researcher: {
          ...state.researcher,
          sprite: 'searching',
          diagnosis: payload.diagnosis ?? event.summary,
          evidence: appendEvidence(state.researcher.evidence, {
            id: `missing-${event.id}`,
            label: payload.missingEvidence ?? 'Independent evidence required',
            status: 'missing',
          }),
        },
        outcome: 'DEFENSE DIAGNOSES FAILURE',
      };
      break;
    case 'zero_discovery_started':
      next = {
        ...next,
        researcher: { ...state.researcher, sprite: 'searching' },
        zero: {
          ...state.zero,
          state: 'discovering',
          capability: 'Searching capability catalog…',
          budgetRemaining: payload.zeroBudgetRemaining ?? state.zero.budgetRemaining,
        },
        outcome: 'ZERO DISCOVERING TOOL',
      };
      break;
    case 'zero_discovery_completed':
      next = {
        ...next,
        researcher: { ...state.researcher, sprite: 'verifying' },
        zero: {
          state: 'activated',
          capability: payload.capabilityLabel ?? 'Verification capability',
          budgetRemaining: payload.zeroBudgetRemaining ?? state.zero.budgetRemaining,
        },
        outcome: 'VERIFICATION TOOL ACTIVATED',
      };
      break;
    case 'evidence_created':
      next = {
        ...next,
        researcher: {
          ...state.researcher,
          sprite: 'verifying',
          diagnosis: payload.finding ?? event.summary,
          evidence: appendEvidence(state.researcher.evidence, {
            id: payload.evidenceId ?? event.id,
            label: payload.finding ?? 'Evidence observed',
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
          memory: [payload.rule ?? 'New regression stored', ...state.researcher.memory].slice(0, 3),
        },
        outcome: 'DEFENSE MEMORY UPDATED',
      };
      break;
    case 'legitimate_candidate_verified': {
      const candidate = payload.candidate ?? {};
      next = {
        ...next,
        candidate: {
          ...state.candidate,
          ...candidate,
          message: payload.message ?? 'Evidence supplied. Ready for a sandbox screen.',
          status: 'verified-for-screen',
        },
        researcher: { ...state.researcher, sprite: 'success' },
        outcome: 'LEGITIMATE CANDIDATE VERIFIED',
      };
      break;
    }
    case 'policy_allowed':
      next = {
        ...next,
        gate: {
          state: 'allowed',
          identity: payload.identity ?? state.gate.identity,
          tool: payload.tool ?? state.gate.tool,
          reason: payload.reason ?? event.summary,
        },
        calendar: { ...state.calendar, state: 'unlocked' },
        outcome: 'CONTROLLER ALLOWED — SAME TOOL',
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
    case 'replay_blocked':
      next = {
        ...next,
        red: {
          ...state.red,
          sprite: 'blocked',
          score: payload.redScore ?? state.red.score,
          memory: [
            `Replay blocked by ${payload.matchedRule ?? 'stored regression'}`,
            ...state.red.memory,
          ].slice(0, 3),
        },
        candidate: {
          ...state.candidate,
          message: payload.mutation ?? state.candidate.message,
        },
        outcome: 'MUTATED REPLAY BLOCKED',
      };
      break;
    case 'memory_updated':
      next = {
        ...next,
        red: {
          ...state.red,
          memory: [payload.redMemory ?? 'Red memory updated', ...state.red.memory].slice(0, 3),
        },
        researcher: {
          ...state.researcher,
          sprite: 'success',
          memory: [payload.whiteMemory ?? 'White memory updated', ...state.researcher.memory].slice(
            0,
            3,
          ),
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

  const playButton = requireElement('play-button');
  const nextButton = requireElement('next-button');
  const restartButton = requireElement('restart-button');
  const speedSelect = requireElement('speed-select');
  const proofDialog = requireElement('proof-dialog');

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

  function applyEvent(event) {
    const priorSequence = state.lastSequence;
    state = reducePresentation(state, event);

    if (state.connection === 'gap' && state.lastSequence === priorSequence) {
      pause();
      // INTEGRATION(pipeline-runtime): on a live sequence gap, fetch
      // GET /api/episodes/:id for the authoritative snapshot, hydrate a presentation snapshot,
      // then let native EventSource resume after its Last-Event-ID. Never guess missing events.
    }

    render(state, manifest, events, handlers);
    if (state.episodeStatus === 'complete' || state.episodeStatus === 'failed') pause();
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

  if (options.mode === 'live') {
    playButton.disabled = true;
    nextButton.disabled = true;
    restartButton.disabled = true;
    if (!options.episodeId) {
      throw new Error('Live mode requires ?mode=live&episode=<episode-id>');
    }

    // INTEGRATION(agent-loop): the loop coordinator publishes normalized GameEvent objects to
    // the server EventSink. The browser must never call Zero, Pomerium, Fillmore, or an agent.
    // INTEGRATION(zero-adapter): normalize discovery/enrichment/evidence results into the
    // candidate_enriched, zero_discovery_*, and evidence_created event kinds before publishing.
    // INTEGRATION(pomerium-adapter): publish policy_denied/policy_allowed with the verified
    // identity, identical tool name, safe reason, and sanitized request ID.
    // INTEGRATION(fillmore-adapter): publish pipeline_created/screen_scheduled with only the
    // sandbox pipeline label and sanitized operation ID; never send credentials to this client.
    const liveSource = new LiveEventSource({
      episodeId: options.episodeId,
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
