import { createHash } from 'node:crypto';

export interface PublicProfileFact {
  readonly key: 'full_name' | 'job_title' | 'company' | 'location' | 'linkedin_url' | 'skills';
  readonly value: string | string[];
  readonly source: 'zero';
}

const PROFILE_CONTAINER_KEYS = ['data', 'result', 'profile', 'person', 'person_profile'] as const;

export function stableArtifactBody(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(sortJson(value));
}

export function hashArtifact(value: unknown): { body: string; sha256: string; byteLength: number } {
  const body = stableArtifactBody(value);
  return {
    body,
    sha256: createHash('sha256').update(body).digest('hex'),
    byteLength: Buffer.byteLength(body, 'utf8'),
  };
}

export function extractLinkedInUrl(value: unknown): string | null {
  const seen = new Set<unknown>();
  const visit = (node: unknown): string | null => {
    if (typeof node === 'string') {
      const match = node.match(/https:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9._%/-]+/);
      return match?.[0] ?? null;
    }
    if (typeof node !== 'object' || node === null || seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }
    for (const item of Object.values(node)) {
      const found = visit(item);
      if (found) return found;
    }
    return null;
  };

  return visit(value);
}

/**
 * Projects provider-specific enrichment output onto a bounded public profile.
 * Contact and arbitrary provider fields are excluded by construction.
 */
export function normalizePublicProfileFacts(value: unknown): PublicProfileFact[] {
  const records = profileRecords(value);
  const facts: PublicProfileFact[] = [];
  const addText = (
    key: Exclude<PublicProfileFact['key'], 'skills'>,
    aliases: readonly string[],
  ): void => {
    const normalized = firstText(records, aliases);
    if (normalized !== null) facts.push({ key, value: normalized, source: 'zero' });
  };

  addText('full_name', ['full_name', 'fullName', 'name']);
  addText('job_title', ['job_title', 'jobTitle', 'title', 'headline']);
  addText('company', ['company', 'current_company', 'currentCompany']);
  addText('location', ['location']);

  const linkedInUrl = firstLinkedInUrl(records, [
    'linkedin_url',
    'linkedinUrl',
    'social_url',
    'socialUrl',
  ]);
  if (linkedInUrl !== null) {
    facts.push({ key: 'linkedin_url', value: linkedInUrl, source: 'zero' });
  }

  const skills = firstSkills(records);
  if (skills.length > 0) facts.push({ key: 'skills', value: skills, source: 'zero' });
  return facts;
}

function profileRecords(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  let frontier: unknown[] = [value];

  for (let depth = 0; depth < 5 && frontier.length > 0; depth += 1) {
    const next: unknown[] = [];
    for (const candidate of frontier) {
      if (!isRecord(candidate) || seen.has(candidate)) continue;
      seen.add(candidate);
      records.push(candidate);
      for (const key of PROFILE_CONTAINER_KEYS) next.push(candidate[key]);
    }
    frontier = next;
  }
  return records;
}

function firstText(
  records: readonly Record<string, unknown>[],
  aliases: readonly string[],
): string | null {
  for (const alias of aliases) {
    for (const record of records) {
      const normalized = boundedText(record[alias]);
      if (normalized !== null) return normalized;
    }
  }
  return null;
}

function boundedText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed.slice(0, 240);
  }
  if (!isRecord(value)) return null;
  for (const key of ['name', 'title', 'label', 'value'] as const) {
    const nested = boundedText(value[key]);
    if (nested !== null) return nested;
  }
  return null;
}

function firstLinkedInUrl(
  records: readonly Record<string, unknown>[],
  aliases: readonly string[],
): string | null {
  for (const record of records) {
    for (const alias of aliases) {
      const value = record[alias];
      if (typeof value !== 'string') continue;
      const linkedInUrl = extractLinkedInUrl(value);
      if (linkedInUrl !== null) return linkedInUrl;
    }
  }
  return null;
}

function firstSkills(records: readonly Record<string, unknown>[]): string[] {
  for (const record of records) {
    const value = record['skills'];
    const candidates = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : [];
    const normalized = candidates.flatMap((candidate) => {
      const skill = boundedText(candidate);
      return skill === null ? [] : [skill.slice(0, 80)];
    });
    if (normalized.length > 0) return [...new Set(normalized)].slice(0, 20);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}
