import { isIP } from 'node:net';

import { ZeroAdapterError, type VerificationNeed, type VerificationTarget } from './types.js';

const DISALLOWED_CAPABILITY_TERMS = [
  'email',
  'phone',
  'contact reveal',
  'contact enrichment',
  'lead enrichment',
  'apollo',
  'wiza individual',
  'bulk contact',
  'send email',
  'send message',
  'messaging',
  'inmail',
];

const NEED_KEYWORDS: Record<VerificationNeed, readonly string[]> = {
  public_page_capture: ['screenshot', 'capture', 'scrape', 'web page'],
  public_claim_lookup: ['search', 'scrape', 'public', 'claim'],
  linkedin_profile_url: ['linkedin', 'profile', 'url'],
  linkedin_profile_enrichment: ['linkedin', 'profile', 'enrichment'],
};

export function assertSafeTarget(input: {
  need: VerificationNeed;
  target: VerificationTarget;
  allowedDomains: readonly string[];
}): void {
  if (input.need === 'linkedin_profile_url') {
    const name = input.target.subject?.name.trim();
    if (!name) {
      throw new ZeroAdapterError('invalid_target', 'linkedin_profile_url requires a subject name');
    }
    return;
  }

  if (input.need === 'linkedin_profile_enrichment') {
    const linkedinUrl = input.target.subject?.linkedinUrl ?? input.target.url;
    if (!linkedinUrl) {
      throw new ZeroAdapterError(
        'invalid_target',
        'linkedin_profile_enrichment requires a LinkedIn profile URL',
      );
    }
    assertSafePublicUrl(linkedinUrl, ['linkedin.com', 'www.linkedin.com']);
    return;
  }

  if (!input.target.url) {
    throw new ZeroAdapterError('invalid_target', `${input.need} requires a public URL`);
  }
  assertSafePublicUrl(input.target.url, input.allowedDomains);

  if (input.need === 'public_claim_lookup' && !input.target.claim?.trim()) {
    throw new ZeroAdapterError('invalid_target', 'public_claim_lookup requires a bounded claim');
  }
}

export function assertSafePublicUrl(rawUrl: string, allowedDomains: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ZeroAdapterError('invalid_target', 'target URL is not parseable');
  }

  if (url.protocol !== 'https:') {
    throw new ZeroAdapterError('invalid_target', 'target URL must use https');
  }
  if (url.username || url.password) {
    throw new ZeroAdapterError('invalid_target', 'target URL must not include userinfo');
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new ZeroAdapterError('invalid_target', 'localhost targets are not allowed');
  }
  if (isUnsafeIpLiteral(hostname)) {
    throw new ZeroAdapterError(
      'invalid_target',
      'private, link-local, and metadata IPs are blocked',
    );
  }

  const normalizedAllowed = allowedDomains.map((domain) => domain.toLowerCase());
  const allowed = normalizedAllowed.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
  if (!allowed) {
    throw new ZeroAdapterError('invalid_target', `target domain ${hostname} is not allowlisted`);
  }

  return url;
}

export function isCapabilityAllowedForNeed(
  need: VerificationNeed,
  capabilityText: string,
): boolean {
  const text = capabilityText.toLowerCase();
  if (DISALLOWED_CAPABILITY_TERMS.some((term) => text.includes(term))) return false;

  if (need === 'linkedin_profile_enrichment' && isExplicitNoPiiProfileEnrichment(text)) {
    return true;
  }

  const required = NEED_KEYWORDS[need];
  return required.every((term) => text.includes(term));
}

function isExplicitNoPiiProfileEnrichment(text: string): boolean {
  const explicitlyExcludesPii = /\bno[ -]pii\b/.test(text);
  const describesPersonProfile =
    text.includes('person') && (text.includes('profile') || text.includes('enrichment'));
  const acceptsPublicProfileInput =
    text.includes('public') || text.includes('social_url') || text.includes('social url');

  return explicitlyExcludesPii && describesPersonProfile && acceptsPublicProfileInput;
}

function isUnsafeIpLiteral(hostname: string): boolean {
  const version = isIP(hostname);
  if (version === 0) return false;

  if (version === 6) {
    return (
      hostname === '::1' ||
      hostname.startsWith('fc') ||
      hostname.startsWith('fd') ||
      hostname.startsWith('fe80:') ||
      hostname === '::' ||
      hostname.toLowerCase().startsWith('::ffff:169.254.')
    );
  }

  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10));
  const [a, b] = parts;
  if (a === undefined || b === undefined) return true;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}
