import { parseUsdToMicroUsd } from './budget.js';
import { isCapabilityAllowedForNeed } from './policy.js';
import type {
  CandidateSubject,
  VerificationNeed,
  VerificationTarget,
  ZeroCapability,
} from './types.js';

export function buildZeroSearchQuery(need: VerificationNeed, target: VerificationTarget): string {
  switch (need) {
    case 'linkedin_profile_url':
      return [
        'LinkedIn Find Profile URL AI-powered',
        subjectQueryFragment(target.subject),
        'return public LinkedIn profile URL only',
      ]
        .filter(Boolean)
        .join(' ');
    case 'linkedin_profile_enrichment':
      return 'Pipe0 Person Profile Enrichment LinkedIn URL public professional profile provenance';
    case 'public_page_capture':
      return 'public web page screenshot capture markdown scrape provenance';
    case 'public_claim_lookup':
      return 'public claim lookup web search scrape citation provenance';
  }
}

export function normalizeCapabilities(
  raw: unknown,
  source: ZeroCapability['source'],
): ZeroCapability[] {
  const capabilities = readPath(raw, ['capabilities']);
  const data = readPath(raw, ['data']);
  const candidates: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(capabilities)
      ? capabilities
      : Array.isArray(data)
        ? data
        : [];

  return candidates.flatMap((candidate) => {
    const normalized = normalizeCapability(candidate, source);
    return normalized ? [normalized] : [];
  });
}

export function normalizeCapability(
  raw: unknown,
  source: ZeroCapability['source'],
): ZeroCapability | null {
  if (!isRecord(raw)) return null;

  const ref =
    stringField(raw, 'token') ??
    stringField(raw, 'uid') ??
    stringField(raw, 'id') ??
    stringField(raw, 'slug');
  if (!ref) return null;

  const name =
    stringField(raw, 'canonicalName') ??
    stringField(raw, 'name') ??
    stringField(raw, 'brandName') ??
    ref;
  const description =
    stringField(raw, 'whatItDoes') ??
    stringField(raw, 'description') ??
    stringField(raw, 'summary') ??
    '';
  const cost =
    parseUsdToMicroUsd(readPath(raw, ['displayCostAmount'])) ??
    parseUsdToMicroUsd(readPath(raw, ['cost', 'amount'])) ??
    parseUsdToMicroUsd(readPath(raw, ['pricing', 'summary'])) ??
    parseUsdToMicroUsd(readPath(raw, ['priceObserved', 'amount'])) ??
    0;

  return {
    ref,
    name,
    description,
    ...(stringField(raw, 'uid') ? { uid: stringField(raw, 'uid') as string } : {}),
    ...(stringField(raw, 'slug') ? { slug: stringField(raw, 'slug') as string } : {}),
    ...(stringField(raw, 'url') ? { url: stringField(raw, 'url') as string } : {}),
    ...(stringField(raw, 'method') ? { method: stringField(raw, 'method') as string } : {}),
    ...(stringField(raw, 'protocol') ? { protocol: stringField(raw, 'protocol') as string } : {}),
    ...(stringField(raw, 'availabilityStatus')
      ? { availabilityStatus: stringField(raw, 'availabilityStatus') as string }
      : {}),
    declaredCostMicroUsd: cost,
    source,
    raw,
  };
}

export function capabilityText(capability: ZeroCapability): string {
  return [
    capability.name,
    capability.description,
    capability.slug,
    capability.url,
    capability.protocol,
  ]
    .filter(Boolean)
    .join(' ');
}

export function isPotentialCapability(need: VerificationNeed, capability: ZeroCapability): boolean {
  return isCapabilityAllowedForNeed(need, capabilityText(capability));
}

function subjectQueryFragment(subject: CandidateSubject | undefined): string {
  if (!subject) return '';
  return [subject.name, subject.company, subject.role, subject.location]
    .filter((value) => value !== undefined && value.trim().length > 0)
    .join(' ');
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
