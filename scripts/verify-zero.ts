import { CliZeroTransport, ZeroVerificationAdapter } from '../src/adapters/zero/index.js';

const live = process.env.ZERO_LIVE_TEST === '1';
const maxPerCallMicroUsd = Number.parseInt(process.env.ZERO_MAX_PER_CALL_MICRO_USD ?? '100000', 10);

if (!live) {
  process.stderr.write('Set ZERO_LIVE_TEST=1 to run the spend-cap Zero smoke test.\n');
  process.exit(0);
}

if (!Number.isInteger(maxPerCallMicroUsd) || maxPerCallMicroUsd <= 0) {
  throw new Error('ZERO_MAX_PER_CALL_MICRO_USD must be a positive integer');
}

process.stderr.write(
  `Zero live smoke max spend: $${(maxPerCallMicroUsd / 1_000_000).toFixed(6)}\n`,
);

const adapter = new ZeroVerificationAdapter({
  mode: 'live',
  transport: new CliZeroTransport({ timeoutMs: 60_000 }),
  transportLabel: 'zero-cli',
});

const discovery = await adapter.discover({
  episodeId: 'episode-live-smoke',
  attemptId: 'attempt-live-smoke',
  need: 'linkedin_profile_url',
  target: {
    subject: {
      name: 'Ada Lovelace',
      company: 'Analytical Engines',
      context: 'Synthetic smoke-test subject; do not use private contact data.',
    },
  },
  allowedDomains: ['linkedin.com'],
  budget: {
    maxPerCallMicroUsd,
    maxEpisodeMicroUsd: maxPerCallMicroUsd,
    spentMicroUsd: 0,
  },
  now: new Date().toISOString(),
});

process.stdout.write(`${JSON.stringify(discovery, null, 2)}\n`);

if (!discovery.selected) {
  throw new Error('Zero smoke test did not find an allowed LinkedIn profile URL capability');
}
