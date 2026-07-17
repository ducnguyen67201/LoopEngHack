const DEFAULT_FIXTURE_URL = '/fixtures/recruiting-contract-events.json';

export async function createEpisode(fetcher = globalThis.fetch) {
  const response = await fetcher('/api/episodes', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Episode start failed with ${response.status}`);
  const started = await response.json();
  if (!started || typeof started.episodeId !== 'string') {
    throw new Error('Episode start response is invalid');
  }
  return started;
}

export async function loadEpisodeSnapshot(episodeId, fetcher = globalThis.fetch) {
  if (!isValidEpisodeId(episodeId)) {
    throw new Error('Snapshot recovery requires a bounded episode identifier');
  }

  const response = await fetcher(`/api/episodes/${encodeURIComponent(episodeId)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Episode snapshot failed with ${response.status}`);

  const snapshot = await response.json();
  if (
    !snapshot ||
    snapshot.episodeId !== episodeId ||
    !Array.isArray(snapshot.events) ||
    !Number.isSafeInteger(snapshot.lastSequence) ||
    snapshot.lastSequence < 0
  ) {
    throw new Error('Episode snapshot response is invalid');
  }
  return snapshot;
}

/**
 * Deterministic presenter source. It deliberately knows nothing about agents or sponsor tools.
 */
export class FixtureEventSource {
  constructor({ fixtureUrl = DEFAULT_FIXTURE_URL } = {}) {
    this.fixtureUrl = fixtureUrl;
  }

  async load() {
    const response = await fetch(this.fixtureUrl, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Fixture request failed with ${response.status}`);
    }

    const fixture = await response.json();
    if (!fixture || !Array.isArray(fixture.events)) {
      throw new Error('Fixture does not contain an events array');
    }

    return fixture;
  }
}

/**
 * One-way live source for the pipeline branch. Native EventSource automatically reconnects and
 * sends Last-Event-ID when the server includes an `id:` line for every message.
 */
export class LiveEventSource {
  constructor({ episodeId, onEvent, onConnection, onError }) {
    this.episodeId = episodeId;
    this.onEvent = onEvent;
    this.onConnection = onConnection;
    this.onError = onError;
    this.connection = null;
  }

  connect(lastSequence = 0) {
    if (!isValidEpisodeId(this.episodeId)) {
      throw new Error('Live mode requires a bounded episode identifier');
    }
    if (!Number.isSafeInteger(lastSequence) || lastSequence < 0) {
      throw new Error('Live mode requires a non-negative resume sequence');
    }

    this.close();

    // INTEGRATION(pipeline-runtime): serve this exact same-origin SSE route from
    // src/server/routes/events.ts. Emit `id: <sequence>` and JSON in `data:`. Do not put a
    // sponsor URL or credential in the browser; the server owns all adapters.
    const resume = lastSequence > 0 ? `?lastSequence=${lastSequence}` : '';
    const endpoint = `/api/episodes/${encodeURIComponent(this.episodeId)}/events${resume}`;
    this.connection = new globalThis.EventSource(endpoint);
    this.onConnection?.('connecting');

    this.connection.addEventListener('open', () => this.onConnection?.('live'));
    this.connection.addEventListener('message', (message) => {
      try {
        this.onEvent(JSON.parse(message.data));
      } catch (error) {
        this.onError?.(error instanceof Error ? error : new Error('Invalid event payload'));
      }
    });
    this.connection.addEventListener('error', () => {
      this.onConnection?.('reconnecting');
    });
  }

  close() {
    this.connection?.close();
    this.connection = null;
  }
}

function isValidEpisodeId(episodeId) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(episodeId);
}

export function readLaunchOptions(search = globalThis.location?.search ?? '') {
  const params = new URLSearchParams(search);
  const requestedMode = params.get('mode') ?? 'fake';
  const mode = ['fake', 'recorded', 'live', 'hybrid'].includes(requestedMode)
    ? requestedMode
    : 'fake';

  return {
    mode,
    episodeId: params.get('episode') ?? '',
    autoplay: params.get('autoplay') === '1',
  };
}
