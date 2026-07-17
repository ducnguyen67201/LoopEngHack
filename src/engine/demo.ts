import { formatEpisodeTrace, runFakeRecruitingEpisode } from './simulator.js';

const state = await runFakeRecruitingEpisode();

process.stdout.write(`${formatEpisodeTrace(state)}\n\n`);
process.stdout.write(
  `${JSON.stringify(
    {
      status: state.episode?.status,
      metrics: state.metrics,
      selectedRedTechnique: [...Object.entries(state.redMemory)].sort(
        ([, left], [, right]) => right.score - left.score,
      )[0]?.[0],
      learnedRegressions: state.regressions.map((regression) => regression.id),
    },
    null,
    2,
  )}\n`,
);
