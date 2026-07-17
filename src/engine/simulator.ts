import type { RecruitingGameState } from '../domain/types.js';
import { RecruitingLoopCoordinator } from './coordinator.js';
import {
  FakeClock,
  FakeEventSink,
  FakeRecruitingOpsPort,
  FakeIdGenerator,
  FakePolicyPort,
  FakeZeroPort,
} from './fakes/index.js';

export async function runFakeRecruitingEpisode(): Promise<RecruitingGameState> {
  const ids = new FakeIdGenerator();
  const clock = new FakeClock();
  const events = new FakeEventSink();
  const coordinator = new RecruitingLoopCoordinator({
    recruitingOps: new FakeRecruitingOpsPort({ ids }),
    zero: new FakeZeroPort({ ids }),
    policy: new FakePolicyPort({ ids }),
    clock,
    ids,
    events,
  });
  return coordinator.runToCompletion();
}

export function formatEpisodeTrace(state: RecruitingGameState): string {
  return state.events
    .map(
      (event) =>
        `${String(event.sequence).padStart(2, '0')}  T${event.turn}  ${event.phase.toUpperCase().padEnd(9)} ${event.actor.padEnd(20)} ${event.kind} — ${event.summary}`,
    )
    .join('\n');
}
