import { FixtureReplay, loadGoldenFixture } from './replay.js';

export const LOOP_PHASES = ['sense', 'plan', 'request', 'authorize', 'execute', 'observe', 'learn'];

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
  'screen_scheduled',
  'regression_stored',
  'replay_result',
  'memory_updated',
  'episode_completed',
  'error',
  // Current recruiting fixture names. The aliases above remain renderable for
  // recorded runs created against the written delivery plan.
  'candidates_researched',
  'candidate_attack_emitted',
  'screening_requested',
  'authorization_decided',
  'verification_requested',
  'capability_discovered',
  'capability_invoked',
  'evidence_created',
  'replay_blocked',
  'red_memory_updated',
  'white_memory_updated',
]);

const RED_SPRITES = {
  idle: '/assets/sprites/social-engineer/idle.png',
  compose: '/assets/sprites/social-engineer/messaging.png',
  attack: '/assets/sprites/social-engineer/bluffing.png',
  celebrate: '/assets/sprites/social-engineer/bluffing.png',
  mutate: '/assets/sprites/social-engineer/messaging.png',
  caught: '/assets/sprites/social-engineer/blocked.png',
};

const WHITE_SPRITES = {
  idle: '/assets/sprites/researcher/idle.png',
  observe: '/assets/sprites/researcher/idle.png',
  diagnose: '/assets/sprites/researcher/verifying.png',
  discover: '/assets/sprites/researcher/searching.png',
  verify: '/assets/sprites/researcher/verifying.png',
  learn: '/assets/sprites/researcher/success.png',
};

const CUE_STATES = {
  'arena-ready': {},
  idle: {},
  pipeline: { fillmore: 'search' },
  attack: { red: 'attack' },
  request: { pomerium: 'scan' },
  search: { zero: 'search', white: 'discover' },
  evidence: { zero: 'invoke', white: 'verify' },
  learn: { white: 'learn' },
  calendar: { controller: 'schedule', fillmore: 'schedule' },
  blocked: { red: 'caught' },
  complete: { red: 'caught', white: 'learn', controller: 'success' },
  'pipeline-search': { fillmore: 'search' },
  'pipeline-send': { fillmore: 'send' },
  'candidate-compose': { red: 'compose' },
  'candidate-attack': { red: 'attack' },
  'candidate-celebrate': { red: 'celebrate' },
  'gate-scan': { pomerium: 'scan' },
  'gate-deny': { pomerium: 'deny', red: 'caught' },
  'gate-allow': { pomerium: 'allow', controller: 'request' },
  'verifier-observe': { white: 'observe' },
  'verifier-diagnose': { white: 'diagnose' },
  'zero-search': { zero: 'search', white: 'discover' },
  'zero-reveal': { zero: 'reveal', white: 'discover' },
  'verifier-verify': { zero: 'invoke', white: 'verify' },
  'verifier-learn': { white: 'learn' },
  'controller-review': { controller: 'review' },
  'controller-schedule': { controller: 'schedule', fillmore: 'schedule' },
  'candidate-mutate': { red: 'mutate' },
  'candidate-caught': { red: 'caught' },
  'episode-success': { red: 'caught', white: 'learn', controller: 'success' },
  error: {},
};

const PIPELINE_TURNS = [
  ['ROLE', 'Brief open'],
  ['SOURCE', 'Candidate found'],
  ['ATTACK', 'Claim received'],
  ['DENY', 'Action contained'],
  ['DIAGNOSE', 'Gap found'],
  ['VERIFY', 'Evidence checked'],
  ['SCHEDULE', 'Test screen'],
  ['REPLAY', 'Mutation blocked'],
  ['LEARN', 'Memory stored'],
];

const DEFAULT_OBJECTIVE =
  'Contain a synthetic recruiting manipulation, verify the claim, then schedule one safe test screen.';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const readable = (value, fallback = '—') => {
  if (typeof value === 'string' && value.trim()) return value.replaceAll('_', ' ');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
};

const firstValue = (payload, paths) => {
  for (const path of paths) {
    let value = payload;
    for (const key of path.split('.')) {
      value = isRecord(value) ? value[key] : undefined;
    }
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const numericValue = (payload, paths, fallback) => {
  const value = Number(firstValue(payload, paths));
  return Number.isFinite(value) ? value : fallback;
};

export function normalizeMode(value) {
  return value === 'live' || value === 'recorded' ? value : 'fake';
}

export function createInitialVisualState(mode = 'fake') {
  return {
    mode: normalizeMode(mode),
    connection: 'loading fixture',
    lastSequence: 0,
    seenSequences: [],
    turn: 0,
    phase: 'sense',
    status: 'ready',
    objective: DEFAULT_OBJECTIVE,
    currentSummary: 'Awaiting the first engine event.',
    currentCue: 'arena-ready',
    actors: {
      red: 'idle',
      fillmore: 'idle',
      white: 'idle',
      controller: 'idle',
      pomerium: 'ready',
      zero: 'closed',
    },
    candidate: {
      label: 'Synthetic recruit',
      role: 'Role not emitted',
      stage: 'WAITING',
      recommendation: 'pending',
      claim: 'No candidate claim observed.',
    },
    gate: {
      decision: 'ready',
      identity: 'awaiting identity',
      tool: 'recruiting_schedule_screen',
      reason: 'No privileged request yet.',
    },
    calendar: { locked: true, count: 0, label: 'No test screen scheduled' },
    integrations: { pomerium: 'ready', zero: 'standby', fillmore: 'standby' },
    memory: {
      technique: 'none selected',
      techniqueScore: '—',
      invariant: 'awaiting failure signal',
      defense: 'awaiting diagnosis',
      regression: 'not stored',
      nextTechnique: 'not selected',
    },
    evidence: { status: 'not collected', id: null, result: 'awaiting verification' },
    metrics: {
      risk: 0,
      denials: 0,
      verified: 0,
      screens: 0,
      breaches: 0,
      zeroSpend: 0,
    },
    proofs: {
      pomeriumDenyRequestId: null,
      pomeriumAllowRequestId: null,
      zeroCapabilityId: null,
      zeroInvocationId: null,
      fillmoreOperationId: null,
      eventHash: null,
      observationId: null,
    },
    trace: [],
    anomaly: null,
    isComplete: false,
    error: null,
  };
}

export function validateGameEvent(candidate) {
  if (!isRecord(candidate)) return { ok: false, reason: 'event is not an object' };
  if (candidate.schemaVersion !== 1)
    return { ok: false, unsupported: true, reason: 'unsupported schema' };
  if (!Number.isInteger(candidate.sequence) || candidate.sequence < 1) {
    return { ok: false, reason: 'sequence must be a positive integer' };
  }
  if (!Number.isInteger(candidate.turn) || candidate.turn < 0 || candidate.turn > 8) {
    return { ok: false, reason: 'turn must be between 0 and 8' };
  }
  if (!LOOP_PHASES.includes(candidate.phase)) return { ok: false, reason: 'unknown loop phase' };
  if (typeof candidate.kind !== 'string' || !candidate.kind.trim()) {
    return { ok: false, reason: 'event kind is required' };
  }
  if (typeof candidate.actor !== 'string' || !candidate.actor.trim()) {
    return { ok: false, reason: 'event actor is required' };
  }
  if (typeof candidate.summary !== 'string' || !candidate.summary.trim()) {
    return { ok: false, reason: 'event summary is required' };
  }
  if (typeof candidate.visualCue !== 'string' || !candidate.visualCue.trim()) {
    return { ok: false, reason: 'visual cue is required' };
  }
  if (!isRecord(candidate.payload)) return { ok: false, reason: 'payload must be an object' };
  if (typeof candidate.occurredAt !== 'string' || Number.isNaN(Date.parse(candidate.occurredAt))) {
    return { ok: false, reason: 'occurredAt must be an ISO timestamp' };
  }
  return { ok: true };
}

function applyCue(actors, cue) {
  const cueState = CUE_STATES[cue];
  return cueState ? { ...actors, ...cueState } : actors;
}

function extractAuthorization(payload) {
  return {
    decision: firstValue(payload, ['decision', 'authorization.decision']),
    identity: firstValue(payload, ['identity', 'authorization.identity', 'serviceAccount']),
    tool: firstValue(payload, ['tool', 'authorization.tool', 'toolName']),
    reason: firstValue(payload, ['reason', 'reasonCode', 'authorization.reason']),
    requestId: firstValue(payload, ['requestId', 'request_id', 'authorization.requestId']),
  };
}

export function extractProofs(event, previous) {
  const payload = event.payload;
  const authorization = extractAuthorization(payload);
  const decision = readable(authorization.decision, '').toLowerCase();
  const requestId = typeof authorization.requestId === 'string' ? authorization.requestId : null;

  return {
    ...previous,
    pomeriumDenyRequestId:
      event.kind === 'policy_decision' && decision === 'deny' && requestId
        ? requestId
        : previous.pomeriumDenyRequestId,
    pomeriumAllowRequestId:
      event.kind === 'policy_decision' && decision === 'allow' && requestId
        ? requestId
        : previous.pomeriumAllowRequestId,
    zeroCapabilityId:
      firstValue(payload, ['capabilityId', 'capability.id', 'selectedCapabilityId']) ??
      previous.zeroCapabilityId,
    zeroInvocationId:
      firstValue(payload, ['invocationId', 'invocation.id', 'zeroInvocationId']) ??
      previous.zeroInvocationId,
    fillmoreOperationId:
      firstValue(payload, ['operationId', 'fillmoreOperationId', 'calendarEventId']) ??
      previous.fillmoreOperationId,
    eventHash:
      firstValue(payload, ['eventHash', 'event_hash', 'artifactSha256', 'digest']) ??
      previous.eventHash,
    observationId: event.observationId ?? previous.observationId,
  };
}

function applyKnownEvent(state, event) {
  const payload = event.payload;
  const authorization = extractAuthorization(payload);
  const next = {
    ...state,
    actors: applyCue(state.actors, event.visualCue),
    candidate: { ...state.candidate },
    gate: { ...state.gate },
    calendar: { ...state.calendar },
    integrations: { ...state.integrations },
    memory: { ...state.memory },
    evidence: { ...state.evidence },
    metrics: { ...state.metrics },
  };

  switch (event.kind) {
    case 'episode_started':
      next.status = 'running';
      next.objective = readable(firstValue(payload, ['objective']), state.objective);
      break;
    case 'role_created':
      next.candidate.role = readable(firstValue(payload, ['roleTitle', 'role.title', 'title']));
      next.candidate.stage = 'ROLE OPEN';
      next.integrations.fillmore = 'role ready';
      break;
    case 'candidate_sourced':
    case 'candidates_researched':
      next.candidate.label = readable(
        firstValue(payload, ['candidateLabel', 'candidate.label', 'label']),
      );
      next.candidate.stage = 'SOURCED';
      next.integrations.fillmore = 'pipeline active';
      break;
    case 'outreach_sent':
      next.candidate.stage = 'OUTREACH SENT';
      next.integrations.fillmore = 'outreach delivered';
      break;
    case 'candidate_replied':
      next.candidate.stage = 'REPLY RECEIVED';
      next.candidate.claim = readable(
        firstValue(payload, ['claimSummary', 'claim', 'messageLabel']),
        'Synthetic candidate reply received.',
      );
      break;
    case 'attack_selected':
    case 'candidate_attack_emitted':
      next.memory.technique = readable(
        firstValue(payload, ['technique', 'attackFamily', 'family']),
      );
      next.memory.techniqueScore = readable(firstValue(payload, ['score', 'methodScore']));
      next.candidate.stage = 'CLAIM RECEIVED';
      next.candidate.claim = event.summary;
      break;
    case 'screen_recommended':
      next.candidate.recommendation = 'unsafe recommendation';
      next.candidate.stage = 'SCREEN REQUESTED';
      next.metrics.risk = numericValue(payload, ['risk', 'riskScore'], 72);
      break;
    case 'tool_requested':
    case 'screening_requested':
      next.gate.decision = 'scan';
      next.gate.identity = readable(
        firstValue(payload, ['identity', 'serviceAccount']),
        event.actor,
      );
      next.gate.tool = readable(firstValue(payload, ['tool', 'toolName']), state.gate.tool);
      next.gate.reason = 'Identity and tool request under review.';
      break;
    case 'policy_decision':
    case 'authorization_decided': {
      const decision = readable(
        authorization.decision,
        event.visualCue === 'gate-allow' ? 'allow' : 'deny',
      );
      next.gate.decision = decision;
      next.gate.identity = readable(authorization.identity, event.actor);
      next.gate.tool = readable(authorization.tool, state.gate.tool);
      next.gate.reason = readable(authorization.reason, event.summary);
      next.integrations.pomerium = decision === 'allow' ? 'controller allowed' : 'sourcer denied';
      if (decision === 'deny') {
        next.calendar.locked = true;
        next.metrics.denials += 1;
      }
      break;
    }
    case 'failure_invariant_stored':
      next.memory.invariant = readable(firstValue(payload, ['invariant', 'failureInvariant']));
      break;
    case 'defense_selected':
      next.memory.defense = readable(firstValue(payload, ['defense', 'defenseId', 'strategy']));
      break;
    case 'verification_requested':
      next.memory.defense = readable(
        firstValue(payload, ['defense', 'defenseId', 'need']),
        'independent authority verification',
      );
      next.integrations.zero = 'capability requested';
      break;
    case 'zero_capability_discovered':
    case 'capability_discovered':
      next.integrations.zero = 'capability discovered';
      next.metrics.zeroSpend = numericValue(
        payload,
        ['spendUsd', 'costUsd', 'budgetUsedUsd'],
        state.metrics.zeroSpend,
      );
      break;
    case 'capability_invoked':
      next.integrations.zero = 'capability invoked';
      next.metrics.zeroSpend =
        numericValue(payload, ['costMicroUsd'], state.metrics.zeroSpend * 1_000_000) / 1_000_000;
      break;
    case 'verification_completed':
      next.evidence.status = 'verified';
      next.evidence.result = readable(
        firstValue(payload, ['result', 'verdict', 'claimStatus']),
        'Independent claim check completed.',
      );
      next.integrations.zero = 'verification returned';
      next.metrics.verified = numericValue(
        payload,
        ['verifiedCandidates', 'verified'],
        state.metrics.verified + 1,
      );
      break;
    case 'evidence_submitted':
    case 'evidence_created':
      next.evidence.status = 'stored';
      next.evidence.id = firstValue(payload, ['evidenceId', 'evidence.id']) ?? state.evidence.id;
      next.evidence.result = 'Hashed independent evidence stored.';
      next.integrations.zero = 'evidence returned';
      next.metrics.verified = Math.max(state.metrics.verified, 1);
      break;
    case 'regression_stored':
      next.memory.regression = readable(
        firstValue(payload, ['regressionId', 'regression.id', 'ruleId']),
      );
      break;
    case 'screen_scheduled':
      next.calendar.locked = false;
      next.calendar.count = numericValue(
        payload,
        ['scheduledCount', 'screenCount'],
        state.calendar.count + 1,
      );
      next.calendar.label = readable(
        firstValue(payload, ['eventLabel', 'calendarLabel']),
        '[HACKATHON TEST] screening event',
      );
      next.candidate.stage = 'TEST SCREEN';
      next.candidate.recommendation = 'evidence approved';
      next.integrations.fillmore = 'screen scheduled';
      next.metrics.screens = next.calendar.count;
      break;
    case 'replay_result':
    case 'replay_blocked': {
      const blocked =
        firstValue(payload, ['blocked', 'regressionMatched']) === true ||
        event.visualCue === 'candidate-caught' ||
        event.visualCue === 'blocked';
      next.candidate.stage = blocked ? 'REPLAY BLOCKED' : 'REPLAY OBSERVED';
      if (blocked) next.metrics.risk = 0;
      break;
    }
    case 'memory_updated':
    case 'red_memory_updated':
    case 'white_memory_updated':
      if (event.actor === 'red-candidate' || event.kind === 'red_memory_updated') {
        next.memory.nextTechnique = readable(firstValue(payload, ['nextTechnique', 'nextFamily']));
        next.memory.techniqueScore = readable(
          firstValue(payload, ['score', 'updatedScore']),
          state.memory.techniqueScore,
        );
      }
      if (event.actor === 'white-verifier' || event.kind === 'white_memory_updated') {
        next.memory.defense = readable(
          firstValue(payload, ['defense', 'defenseId']),
          state.memory.defense,
        );
        next.memory.regression = readable(
          firstValue(payload, ['regressionId', 'regression.id']),
          state.memory.regression,
        );
      }
      break;
    case 'episode_completed':
      next.status = 'complete';
      next.isComplete = true;
      next.metrics.breaches = numericValue(payload, ['unauthorizedActions', 'policyBreaches'], 0);
      next.metrics.screens = numericValue(payload, ['verifiedScreens'], next.metrics.screens);
      break;
    case 'error':
      next.status = 'error';
      next.error = event.summary;
      break;
  }

  return next;
}

export function reduceGameEvent(state, event) {
  const validation = validateGameEvent(event);
  if (!validation.ok) {
    return {
      state,
      outcome: validation.unsupported ? 'unsupported' : 'invalid',
      reason: validation.reason,
    };
  }

  if (state.seenSequences.includes(event.sequence)) {
    return { state, outcome: 'duplicate', reason: `sequence ${event.sequence} already rendered` };
  }
  if (event.sequence < state.lastSequence) {
    return { state, outcome: 'out-of-order', reason: `sequence ${event.sequence} is stale` };
  }
  const expectedSequence = state.lastSequence + 1;
  if (event.sequence > expectedSequence) {
    return {
      state: {
        ...state,
        anomaly: { type: 'gap', expected: expectedSequence, received: event.sequence },
        connection: 'sequence gap · sync required',
      },
      outcome: 'gap',
      reason: `expected sequence ${expectedSequence}, received ${event.sequence}`,
    };
  }

  const isKnown = KNOWN_EVENT_KINDS.has(event.kind);
  const reducedState = isKnown ? applyKnownEvent(state, event) : state;
  const traceItem = {
    sequence: event.sequence,
    turn: event.turn,
    phase: event.phase,
    kind: event.kind,
    actor: event.actor,
    summary: event.summary,
    occurredAt: event.occurredAt,
    recognized: isKnown,
    observationId: event.observationId ?? null,
  };

  return {
    state: {
      ...reducedState,
      lastSequence: event.sequence,
      seenSequences: [...state.seenSequences, event.sequence],
      turn: event.turn,
      phase: event.phase,
      currentSummary: isKnown ? event.summary : `Unrecognized event: ${event.summary}`,
      currentCue: isKnown ? event.visualCue : state.currentCue,
      proofs: extractProofs(event, state.proofs),
      trace: [...state.trace, traceItem].slice(-80),
      anomaly: null,
    },
    outcome: 'applied',
    reason: isKnown ? null : 'unknown event kind rendered as trace only',
  };
}

export function reduceGameEvents(events, mode = 'fake') {
  let state = createInitialVisualState(mode);
  const outcomes = [];
  for (const event of events) {
    const result = reduceGameEvent(state, event);
    state = result.state;
    outcomes.push(result.outcome);
  }
  return { state, outcomes };
}

export function getKeyboardCommand(key) {
  if (key === ' ' || key === 'Spacebar') return 'toggle-play';
  if (key === 'ArrowRight') return 'next';
  if (key === 'Home') return 'restart';
  if (key.toLowerCase() === 'p') return 'proof';
  return null;
}

function setText(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) element.textContent = readable(value);
}

function setSprite(root, selector, source, state) {
  const image = root.querySelector(selector);
  if (!image) return;
  image.src = source;
  image.dataset.state = state;
}

function renderTrace(root, trace) {
  const list = root.querySelector('#event-trace');
  if (!list) return;
  const fragment = document.createDocumentFragment();
  for (const item of trace.slice(-7).reverse()) {
    const row = document.createElement('li');
    row.className = item.recognized ? 'trace-row' : 'trace-row trace-row--unknown';
    row.title = item.summary;
    const sequence = document.createElement('span');
    sequence.className = 'trace-sequence';
    sequence.textContent = String(item.sequence).padStart(2, '0');
    const meta = document.createElement('span');
    meta.className = 'trace-meta';
    meta.textContent = `${item.actor} · ${item.kind.replaceAll('_', ' ')}`;
    const summary = document.createElement('span');
    summary.className = 'trace-summary';
    summary.textContent = item.summary;
    row.append(sequence, meta, summary);
    fragment.append(row);
  }
  list.replaceChildren(fragment);
}

function renderTurns(root, turn) {
  for (const element of root.querySelectorAll('[data-turn]')) {
    const itemTurn = Number(element.dataset.turn);
    element.classList.toggle('is-complete', itemTurn < turn);
    element.classList.toggle('is-current', itemTurn === turn);
    element.classList.toggle('is-future', itemTurn > turn);
    if (itemTurn === turn) element.setAttribute('aria-current', 'step');
    else element.removeAttribute('aria-current');
  }
}

function renderProofs(root, proofs) {
  const entries = {
    '#proof-pomerium-deny': proofs.pomeriumDenyRequestId,
    '#proof-pomerium-allow': proofs.pomeriumAllowRequestId,
    '#proof-zero-capability': proofs.zeroCapabilityId,
    '#proof-zero-invocation': proofs.zeroInvocationId,
    '#proof-fillmore-operation': proofs.fillmoreOperationId,
    '#proof-event-hash': proofs.eventHash,
    '#proof-observation': proofs.observationId,
  };
  for (const [selector, value] of Object.entries(entries)) {
    setText(root, selector, value ?? 'not emitted yet');
  }
}

export function renderArena(root, state, playback = { isPlaying: false, canAdvance: false }) {
  root.dataset.cue = state.currentCue;
  root.dataset.gate = state.gate.decision;
  root.dataset.status = state.status;

  setText(root, '#mode-badge', state.mode.toUpperCase());
  setText(root, '#connection-state', state.connection);
  setText(root, '#objective', state.objective);
  setText(root, '#turn-value', `${state.turn} / 8`);
  setText(root, '#phase-value', state.phase.toUpperCase());
  setText(root, '#pomerium-health', state.integrations.pomerium);
  setText(root, '#zero-budget', `$${state.metrics.zeroSpend.toFixed(2)}`);
  setText(root, '#fillmore-state', state.integrations.fillmore);
  setText(root, '#risk-value', state.metrics.risk);
  setText(root, '#screens-value', state.metrics.screens);
  setText(root, '#breaches-value', state.metrics.breaches);
  setText(root, '#denials-value', state.metrics.denials);
  setText(root, '#event-summary', state.currentSummary);

  setText(root, '#candidate-label', state.candidate.label);
  setText(root, '#candidate-role', state.candidate.role);
  setText(root, '#candidate-stage', state.candidate.stage);
  setText(root, '#candidate-claim', state.candidate.claim);
  setText(root, '#candidate-recommendation', state.candidate.recommendation);
  setText(root, '#red-state', state.actors.red.toUpperCase());
  setText(root, '#red-technique', state.memory.technique);
  setText(root, '#red-score', state.memory.techniqueScore);
  setText(root, '#red-next', state.memory.nextTechnique);
  setText(root, '#failure-invariant', state.memory.invariant);
  setText(root, '#defense-memory', state.memory.defense);
  setText(root, '#regression-memory', state.memory.regression);
  setText(root, '#evidence-status', state.evidence.status);
  setText(root, '#evidence-result', state.evidence.result);
  setText(root, '#white-state', state.actors.white.toUpperCase());

  setText(root, '#gate-decision', state.gate.decision.toUpperCase());
  setText(root, '#gate-identity', state.gate.identity);
  setText(root, '#gate-tool', state.gate.tool);
  setText(root, '#gate-reason', state.gate.reason);
  setText(root, '#calendar-lock', state.calendar.locked ? 'LOCKED' : 'UNLOCKED');
  setText(root, '#calendar-label', state.calendar.label);
  setText(root, '#calendar-count', state.calendar.count);
  setText(root, '#zero-state', state.integrations.zero);

  setSprite(
    root,
    '#red-sprite',
    RED_SPRITES[state.actors.red] ?? RED_SPRITES.idle,
    state.actors.red,
  );
  setSprite(
    root,
    '#white-sprite',
    WHITE_SPRITES[state.actors.white] ?? WHITE_SPRITES.idle,
    state.actors.white,
  );

  const playButton = root.querySelector('#play-toggle');
  if (playButton) {
    playButton.textContent = playback.isPlaying ? 'PAUSE' : 'PLAY';
    playButton.setAttribute(
      'aria-label',
      playback.isPlaying ? 'Pause event replay' : 'Play event replay',
    );
    playButton.disabled = !playback.canAdvance;
  }
  const nextButton = root.querySelector('#next-event');
  if (nextButton) nextButton.disabled = !playback.canAdvance;
  const restartButton = root.querySelector('#restart-episode');
  if (restartButton) restartButton.disabled = state.mode === 'live';

  const gate = root.querySelector('#pomerium-gate');
  if (gate) gate.className = `gate gate--${state.gate.decision}`;
  const calendar = root.querySelector('#calendar-card');
  if (calendar) calendar.classList.toggle('calendar--unlocked', !state.calendar.locked);
  const warning = root.querySelector('#sync-warning');
  if (warning) {
    warning.hidden = state.anomaly === null && state.error === null;
    warning.textContent =
      state.error ??
      (state.anomaly
        ? `Sequence gap: expected ${state.anomaly.expected}, received ${state.anomaly.received}. Replay paused.`
        : '');
  }

  renderTurns(root, state.turn);
  renderTrace(root, state.trace);
  renderProofs(root, state.proofs);

  const liveStatus = root.querySelector('#live-status');
  if (liveStatus && liveStatus.dataset.sequence !== String(state.lastSequence)) {
    liveStatus.dataset.sequence = String(state.lastSequence);
    liveStatus.textContent = `Turn ${state.turn}, ${state.phase}. ${state.currentSummary}`;
  }
}

function isEditableTarget(target) {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, select, textarea') || target.isContentEditable)
  );
}

function fixtureEvents(body) {
  if (Array.isArray(body)) return body;
  if (isRecord(body) && Array.isArray(body.events)) return body.events;
  return [];
}

export async function bootstrapArena(root = document) {
  const shell = root.querySelector('#arena-shell');
  if (!shell) return null;

  const parameters = new URLSearchParams(window.location.search);
  const mode = normalizeMode(parameters.get('mode') ?? shell.dataset.mode);
  let state = createInitialVisualState(mode);
  let replay = null;
  let liveSource = null;
  let reconnectTimer = null;

  const playbackState = () => ({
    isPlaying: replay?.isPlaying ?? false,
    canAdvance: replay ? replay.hasNext && !state.error : false,
  });

  const render = () => renderArena(shell, state, playbackState());
  const setConnection = (connection) => {
    state = { ...state, connection };
    render();
  };

  const ingest = (event) => {
    const result = reduceGameEvent(state, event);
    state = result.state;
    if (result.outcome === 'gap' || state.error) replay?.pause();
    render();
    return result.outcome !== 'gap' && result.outcome !== 'invalid';
  };

  const resetPresentation = () => {
    state = {
      ...createInitialVisualState(mode),
      connection: mode === 'live' ? 'connecting' : 'fixture ready',
    };
    render();
  };

  const openProof = () => {
    const drawer = shell.querySelector('#proof-drawer');
    if (drawer && !drawer.open) drawer.showModal();
  };

  const performCommand = (command) => {
    if (command === 'toggle-play') replay?.toggle();
    if (command === 'next') replay?.next();
    if (command === 'restart' && mode !== 'live') replay?.restart();
    if (command === 'proof') openProof();
    render();
  };

  shell
    .querySelector('#play-toggle')
    ?.addEventListener('click', () => performCommand('toggle-play'));
  shell.querySelector('#next-event')?.addEventListener('click', () => performCommand('next'));
  shell
    .querySelector('#restart-episode')
    ?.addEventListener('click', () => performCommand('restart'));
  shell.querySelector('#show-proof')?.addEventListener('click', openProof);
  shell
    .querySelector('#close-proof')
    ?.addEventListener('click', () => shell.querySelector('#proof-drawer')?.close());
  shell.querySelector('#playback-speed')?.addEventListener('change', (event) => {
    replay?.setSpeed(Number(event.target.value));
    render();
  });
  window.addEventListener('keydown', (event) => {
    if (isEditableTarget(event.target)) return;
    const command = getKeyboardCommand(event.key);
    if (!command) return;
    event.preventDefault();
    performCommand(command);
  });

  const connectLive = () => {
    const endpoint = shell.dataset.eventStreamUrl;
    if (!endpoint) {
      setConnection('live endpoint not configured');
      return;
    }
    const url = new URL(endpoint, window.location.href);
    url.searchParams.set('lastSequence', String(state.lastSequence));
    setConnection('connecting live stream');
    liveSource = new EventSource(url);
    liveSource.addEventListener('open', () => setConnection('live stream connected'));
    liveSource.addEventListener('message', (message) => {
      try {
        ingest(JSON.parse(message.data));
      } catch {
        setConnection('invalid live event ignored');
      }
    });
    liveSource.addEventListener('error', () => {
      liveSource?.close();
      setConnection('live stream reconnecting');
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(connectLive, 1500);
    });
  };

  render();
  if (mode === 'live') {
    connectLive();
    return { getState: () => state, disconnect: () => liveSource?.close() };
  }

  try {
    const fixture = await loadGoldenFixture(
      shell.dataset.fixtureUrl ?? '/fixtures/recruiting-contract-events.json',
    );
    const events = fixtureEvents(fixture);
    replay = new FixtureReplay(events, {
      onEvent: ingest,
      onRestart: resetPresentation,
      onChange: render,
    });
    setConnection(`${mode} fixture ready · ${events.length} events`);
  } catch (error) {
    state = {
      ...state,
      connection: 'fixture unavailable',
      status: 'error',
      error: error instanceof Error ? error.message : 'Unable to load fixture.',
    };
    render();
  }

  return { getState: () => state, replay };
}

if (typeof document !== 'undefined') {
  void bootstrapArena();
}

export { PIPELINE_TURNS };
