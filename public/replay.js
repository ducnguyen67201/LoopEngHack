const DEFAULT_FIXTURE_URL = '/fixtures/hire-me-if-you-can-events.json';

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

  connect() {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(this.episodeId)) {
      throw new Error('Live mode requires a bounded episode identifier');
    }

    // INTEGRATION(pipeline-runtime): serve this exact same-origin SSE route from
    // src/server/routes/events.ts. Emit `id: <sequence>` and JSON in `data:`. Do not put a
    // sponsor URL or credential in the browser; the server owns all adapters.
    const endpoint = `/api/episodes/${encodeURIComponent(this.episodeId)}/events`;
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
    this.onConnection?.('closed');
  }
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
