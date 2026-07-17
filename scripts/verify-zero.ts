import { createLiveZeroPort, type ClaimTargetResolver } from '../src/adapters/zero/index.js';
import type { ExecutionContext, Observation } from '../src/domain/types.js';

const HARD_SPEND_CEILING_MICRO_USD = 100_000;
const live = process.env.ZERO_LIVE_TEST === '1';

if (!live) {
  process.stderr.write(
    'Set ZERO_LIVE_TEST=1 to run one real, spend-capped Zero discovery and invocation.\n',
  );
  process.exit(0);
}

const maxPerCallMicroUsd = positiveInteger(
  process.env.ZERO_MAX_PER_CALL_MICRO_USD ?? '100000',
  'ZERO_MAX_PER_CALL_MICRO_USD',
);
if (maxPerCallMicroUsd > HARD_SPEND_CEILING_MICRO_USD) {
  throw new Error(
    `ZERO_MAX_PER_CALL_MICRO_USD cannot exceed the smoke-test hard ceiling of ${HARD_SPEND_CEILING_MICRO_USD}`,
  );
}

const allowedCapabilityRefs = commaSeparated(
  process.env.ZERO_ALLOWED_CAPABILITY_REFS,
  'ZERO_ALLOWED_CAPABILITY_REFS',
);
const targetUrl = new URL(process.env.ZERO_VERIFY_TARGET_URL ?? 'https://example.com/');
const allowedTargetDomains = commaSeparated(
  process.env.ZERO_ALLOWED_TARGET_DOMAINS ?? targetUrl.hostname,
  'ZERO_ALLOWED_TARGET_DOMAINS',
);
const episodeId = 'episode-zero-live-smoke';
const claimId = 'claim-zero-live-smoke';
const claimTargetResolver: ClaimTargetResolver = {
  resolve: (requestedClaimId) => {
    if (requestedClaimId !== claimId) {
      return Promise.reject(new Error('unknown Zero smoke-test claim'));
    }
    return Promise.resolve({
      target: { url: targetUrl.toString() },
      allowedDomains: allowedTargetDomains,
    });
  },
};

process.stderr.write(
  `Zero live verification will allow at most $${(maxPerCallMicroUsd / 1_000_000).toFixed(6)} for one invocation.\n`,
);

const runtime = createLiveZeroPort({
  binary: process.env.ZERO_RUNNER ?? 'zero',
  timeoutMs: positiveInteger(process.env.ZERO_TIMEOUT_MS ?? '60000', 'ZERO_TIMEOUT_MS'),
  allowedCapabilityRefs,
  allowedTargetDomains,
  maxPerCallMicroUsd,
  maxEpisodeMicroUsd: maxPerCallMicroUsd,
  claimTargetResolver,
});

const probe = await runtime.probe();
if (probe.status !== 'ready_for_discovery') {
  process.stdout.write(`${JSON.stringify({ probe }, null, 2)}\n`);
  throw new Error('Zero startup probe did not find an explicitly allowlisted capability');
}

const discoveryContext = context(episodeId, 'attempt-zero-live-discover');
const discovery = await runtime.port.discover(
  {
    episodeId,
    attemptId: discoveryContext.attemptId,
    tool: 'zero_discover_verifier',
    need: 'public_page_capture',
  },
  discoveryContext,
);
const capabilityId = stringFact(discovery, 'capability_id');
const declaredCostUsd = numberFact(discovery, 'cost_usd');
if (discovery.status !== 'success' || capabilityId === null || declaredCostUsd === null) {
  process.stdout.write(
    `${JSON.stringify({ probe, discovery: summarizeObservation(discovery) }, null, 2)}\n`,
  );
  throw new Error('Zero live discovery failed before invocation');
}

const invocationContext = context(episodeId, 'attempt-zero-live-invoke');
const invocation = await runtime.port.invoke(
  {
    episodeId,
    attemptId: invocationContext.attemptId,
    tool: 'zero_run_verifier',
    need: 'public_page_capture',
    capabilityId,
    claimId,
  },
  invocationContext,
);

const sanitizedOutput = {
  probe,
  spendPolicy: {
    hardCeilingMicroUsd: HARD_SPEND_CEILING_MICRO_USD,
    invocationCeilingMicroUsd: maxPerCallMicroUsd,
    declaredCostMicroUsd: Math.round(declaredCostUsd * 1_000_000),
  },
  discovery: summarizeObservation(discovery),
  invocation: summarizeObservation(invocation),
};
process.stdout.write(`${JSON.stringify(sanitizedOutput, null, 2)}\n`);

if (invocation.status !== 'success') {
  throw new Error('Zero live invocation did not return successful bounded evidence');
}

function context(currentEpisodeId: string, attemptId: string): ExecutionContext {
  return {
    episodeId: currentEpisodeId,
    attemptId,
    turn: 5,
    actor: 'white-verifier',
    phase: 'execute',
    occurredAt: new Date().toISOString(),
  };
}

function summarizeObservation(observation: Observation) {
  return {
    status: observation.status,
    ...(observation.errorCategory ? { errorCategory: observation.errorCategory } : {}),
    summary: observation.summary,
    capabilityId: stringFact(observation, 'capability_id'),
    artifactDigests: observation.artifacts.flatMap((artifact) =>
      artifact.digest === undefined ? [] : [artifact.digest],
    ),
  };
}

function stringFact(observation: Observation, key: string): string | null {
  const value = observation.facts.find((fact) => fact.key === key)?.value;
  return typeof value === 'string' ? value : null;
}

function numberFact(observation: Observation, key: string): number | null {
  const value = observation.facts.find((fact) => fact.key === key)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveInteger(raw: string, name: string): number {
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function commaSeparated(raw: string | undefined, name: string): string[] {
  const values = [...new Set((raw ?? '').split(',').map((value) => value.trim()))].filter(
    (value) => value.length > 0,
  );
  if (values.length === 0) throw new Error(`${name} must contain at least one value`);
  return values;
}
