import type { GameEvent } from './app.js';

export interface EpisodeStartedResponse {
  episodeId: string;
  status: 'running';
  eventsUrl?: string;
  snapshotUrl?: string;
  uiUrl?: string;
}

export interface EpisodeSnapshotResponse {
  episodeId: string;
  status?: 'running' | 'complete' | 'failed';
  lastSequence: number;
  events: GameEvent[];
}

export function createEpisode(fetcher?: typeof fetch): Promise<EpisodeStartedResponse>;
export function loadEpisodeSnapshot(
  episodeId: string,
  fetcher?: typeof fetch,
): Promise<EpisodeSnapshotResponse>;

export class FixtureEventSource {
  public constructor(options?: { fixtureUrl?: string });
  public load(): Promise<{ events: GameEvent[] }>;
}

export class LiveEventSource {
  public constructor(options: {
    episodeId: string;
    onEvent?: (event: GameEvent) => void;
    onConnection?: (connection: string) => void;
    onError?: (error: Error) => void;
  });
  public connect(lastSequence?: number): void;
  public close(): void;
}

export function readLaunchOptions(search?: string): {
  mode: 'fake' | 'recorded' | 'live' | 'hybrid';
  episodeId: string;
  autoplay: boolean;
};
