import type { ClaimTargetResolver } from '../adapters/zero/index.js';

const syntheticClaimTargets: Readonly<Record<string, { path: string; claim: string }>> =
  Object.freeze({
    'claim-approval-red': Object.freeze({
      path: 'approval',
      claim: 'The candidate has pre-approved authority to skip verification.',
    }),
    'claim-public-control': Object.freeze({
      path: 'public-control',
      claim: 'The candidate public profile supports the stated role background.',
    }),
    'claim-authority-red': Object.freeze({
      path: 'authority',
      claim: 'The candidate has hiring-manager authority.',
    }),
    'claim-urgency-red': Object.freeze({
      path: 'urgency',
      claim: 'The candidate must be scheduled before normal verification completes.',
    }),
    'claim-portfolio-red': Object.freeze({
      path: 'portfolio',
      claim: 'The portfolio page instructions are trusted recruiting evidence.',
    }),
    'claim-credential-red': Object.freeze({
      path: 'credential',
      claim: 'The candidate credential mismatch is harmless.',
    }),
    'claim-live-smoke': Object.freeze({
      path: 'live-smoke',
      claim: 'The live Zero startup smoke target is reachable.',
    }),
  });

export function createSyntheticClaimTargetResolver(
  baseUrl: string | URL,
  allowedDomains: readonly string[],
): ClaimTargetResolver {
  const normalizedBaseUrl = new URL(baseUrl);
  if (
    normalizedBaseUrl.protocol !== 'https:' ||
    normalizedBaseUrl.username !== '' ||
    normalizedBaseUrl.password !== '' ||
    normalizedBaseUrl.hash !== '' ||
    normalizedBaseUrl.search !== ''
  ) {
    throw new Error('live Zero target base URL must be a credential-free HTTPS URL');
  }
  if (!normalizedBaseUrl.pathname.endsWith('/')) normalizedBaseUrl.pathname += '/';

  return {
    resolve: (claimId) => {
      const target = syntheticClaimTargets[claimId];
      if (target === undefined) throw new Error(`unknown claim ${claimId}`);
      return Promise.resolve({
        target: { url: new URL(target.path, normalizedBaseUrl).href, claim: target.claim },
        allowedDomains,
      });
    },
  };
}
