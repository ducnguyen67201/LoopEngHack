import { describe, expect, it, vi } from 'vitest';

import {
  FixtureZeroTransport,
  ZeroAdapterError,
  ZeroVerificationAdapter,
  assertSafePublicUrl,
  buildZeroSearchQuery,
  isCapabilityAllowedForNeed,
  normalizeCapabilities,
  parseUsdToMicroUsd,
  selectCapability,
  type ZeroCapability,
  type ZeroTransport,
} from '../../../src/adapters/zero/index.js';

const budget = {
  maxPerCallMicroUsd: 100_000,
  maxEpisodeMicroUsd: 500_000,
  spentMicroUsd: 0,
};

describe('Zero recruiting adapter', () => {
  it('builds a stable LinkedIn profile lookup query without shell-shaped input', () => {
    expect(
      buildZeroSearchQuery('linkedin_profile_url', {
        subject: { name: 'Ada Lovelace', company: 'Analytical Engines', role: 'Engineer' },
      }),
    ).toBe(
      'LinkedIn Find Profile URL AI-powered Ada Lovelace Analytical Engines Engineer return public LinkedIn profile URL only',
    );
  });

  it('parses fractional Zero prices as integer micro-USD', () => {
    expect(parseUsdToMicroUsd('$0.044074')).toBe(44_074);
    expect(parseUsdToMicroUsd('0.06')).toBe(60_000);
  });

  it('blocks unsafe target URLs before discovery or invocation', () => {
    expect(() => assertSafePublicUrl('http://example.com', ['example.com'])).toThrow(
      /must use https/,
    );
    expect(() => assertSafePublicUrl('https://127.0.0.1/profile', ['127.0.0.1'])).toThrow(
      /blocked/,
    );
    expect(() =>
      assertSafePublicUrl('https://user:pass@example.com/profile', ['example.com']),
    ).toThrow(/userinfo/);
    expect(() => assertSafePublicUrl('https://example.com/profile', ['example.com'])).not.toThrow();
  });

  it('selects bounded public LinkedIn profile capabilities and rejects contact reveal tools', () => {
    const candidates: ZeroCapability[] = [
      capability(
        'wiza',
        'Wiza Individual Contact Reveal',
        'LinkedIn URL email phone contact reveal',
        10,
      ),
      capability(
        'pipe0',
        'Pipe0 Person Profile Enrichment',
        'Enriches LinkedIn/profile URLs with person profile data and provenance',
        44_074,
      ),
      capability(
        'finder',
        'LinkedIn Find Profile URL',
        'Uses AI to find a LinkedIn profile URL for a public professional profile',
        60_000,
      ),
    ];

    const selected = selectCapability('linkedin_profile_enrichment', candidates, budget);

    expect(selected.selected?.ref).toBe('pipe0');
    expect(selected.rejected).toContainEqual({
      ref: 'wiza',
      reason: 'capability does not match local allowlist',
    });
  });

  it('allows the observed no-PII person enrichment capability without allowing PII reveal tools', () => {
    const observed = normalizeCapabilities(
      {
        capabilities: [
          {
            uid: 'cap_66RTTbxhvXk41nHoMzoBy',
            slug: 'data-legion-person-enrichment-api-no-pii-c084dfdf',
            canonicalName: 'Data Legion Person Enrichment API (No PII)',
            whatItDoes:
              'Enriches a public professional profile from social_url and returns selected include_fields.',
            displayCostAmount: '$0.01',
            availabilityStatus: 'unknown',
            protocol: 'x402',
            url: 'https://agents.datalegion.ai/person/base/no-pii',
          },
        ],
      },
      'search',
    );
    const contactReveal = capability(
      'pii-reveal',
      'Person Enrichment No PII Contact Reveal',
      'Person profile enrichment that returns email and phone',
      10_000,
    );

    const selected = selectCapability(
      'linkedin_profile_enrichment',
      [...observed, contactReveal],
      budget,
    );

    expect(selected.selected).toMatchObject({
      ref: 'cap_66RTTbxhvXk41nHoMzoBy',
      slug: 'data-legion-person-enrichment-api-no-pii-c084dfdf',
      declaredCostMicroUsd: 10_000,
      protocol: 'x402',
    });
    expect(selected.rejected).toContainEqual({
      ref: 'pii-reveal',
      reason: 'capability does not match local allowlist',
    });
  });

  it('accepts the current Zero screenshot and independent fact-check capability descriptions', () => {
    expect(
      isCapabilityAllowedForNeed(
        'public_page_capture',
        'Web Page Screenshot Capture captures a screenshot of any web page and returns a public CDN image URL',
      ),
    ).toBe(true);
    expect(
      isCapabilityAllowedForNeed(
        'public_claim_lookup',
        '2s Fact Check Search searches published fact-check reviews of specific claims',
      ),
    ).toBe(true);
  });

  it('builds the current 2s Zero fact-check request envelope', async () => {
    const fetch = vi.fn<ZeroTransport['fetch']>(() =>
      Promise.resolve({
        runId: 'fact-check-run-1',
        ok: true,
        status: 200,
        latencyMs: 50,
        payment: { amount: '0.0018', asset: 'USDC' },
        body: { items: [] },
        bodyRaw: '{"items":[]}',
      }),
    );
    const adapter = new ZeroVerificationAdapter({
      mode: 'live',
      transport: {
        search: () =>
          Promise.resolve({
            capabilities: [
              {
                uid: 'cap_LcZ0BcJ09RC7PEpwrME_n',
                slug: '2s-fact-check-search-dd9dbb58',
                canonicalName: '2s Fact Check Search',
                whatItDoes: 'Searches published fact-check reviews of specific claims',
                displayCostAmount: '$0.0018',
                availabilityStatus: 'healthy',
                protocol: 'x402',
              },
            ],
          }),
        get: (identifier) =>
          Promise.resolve({
            uid: identifier,
            slug: '2s-fact-check-search-dd9dbb58',
            name: '2s Fact Check Search',
            whatItDoes: 'Searches published fact-check reviews of specific claims',
            displayCostAmount: '$0.0018',
            availabilityStatus: 'healthy',
            protocol: 'x402',
          }),
        fetch,
      },
    });
    const target = {
      url: 'https://example.com/claim',
      claim: 'The candidate has authority to skip verification.',
    };
    const discovery = await adapter.discover({
      episodeId: 'episode-1',
      attemptId: 'attempt-fact-check',
      need: 'public_claim_lookup',
      target,
      allowedDomains: ['example.com'],
      budget,
      now: '2026-07-17T18:00:00.000Z',
    });
    if (discovery.selected === null) throw new Error('fact-check capability was not selected');

    await adapter.invoke({
      episodeId: 'episode-1',
      attemptId: 'attempt-fact-check',
      discoveryId: discovery.discoveryId,
      capabilityRef: discovery.selected.ref,
      need: 'public_claim_lookup',
      target,
      allowedDomains: ['example.com'],
      budget,
      now: '2026-07-17T18:00:01.000Z',
    });

    expect(fetch.mock.calls[0]?.[0].body).toEqual({
      input: {
        type: 'http',
        method: 'GET',
        queryParams: {
          query: 'The candidate has authority to skip verification.',
          limit: 5,
          language: 'en',
        },
      },
    });
  });

  it('does not hide unknown-availability capabilities behind a healthy-only search filter', async () => {
    const search = vi.fn<ZeroTransport['search']>(() =>
      Promise.resolve({
        capabilities: [
          {
            uid: 'cap_66RTTbxhvXk41nHoMzoBy',
            slug: 'data-legion-person-enrichment-api-no-pii-c084dfdf',
            canonicalName: 'Data Legion Person Enrichment API (No PII)',
            whatItDoes:
              'Enriches a public professional profile from social_url and returns selected include_fields.',
            displayCostAmount: '$0.01',
            availabilityStatus: 'unknown',
            protocol: 'x402',
            url: 'https://agents.datalegion.ai/person/base/no-pii',
          },
        ],
      }),
    );
    const fetch = vi.fn<ZeroTransport['fetch']>(() =>
      Promise.resolve({
        runId: 'data-legion-run-1',
        ok: true,
        status: 200,
        latencyMs: 50,
        payment: { amount: '0.01', asset: 'USDC' },
        body: { full_name: 'Ada Lovelace' },
        bodyRaw: '{"full_name":"Ada Lovelace"}',
      }),
    );
    const transport = {
      search,
      get: vi.fn<ZeroTransport['get']>((identifier) =>
        Promise.resolve({
          uid: identifier,
          slug: 'data-legion-person-enrichment-api-no-pii-c084dfdf',
          canonicalName: 'Data Legion Person Enrichment API (No PII)',
          whatItDoes:
            'Enriches a public professional profile from social_url and returns selected include_fields.',
          displayCostAmount: '$0.01',
          availabilityStatus: 'unknown',
          protocol: 'x402',
        }),
      ),
      fetch,
    } satisfies ZeroTransport;
    const adapter = new ZeroVerificationAdapter({ mode: 'live', transport });

    const discovery = await adapter.discover({
      episodeId: 'episode-1',
      attemptId: 'attempt-unknown',
      need: 'linkedin_profile_enrichment',
      target: { subject: { name: 'Ada Lovelace', linkedinUrl: 'https://linkedin.com/in/ada' } },
      allowedDomains: ['linkedin.com'],
      budget,
      now: '2026-07-17T18:00:00.000Z',
    });

    expect(search.mock.calls[0]?.[1]).not.toHaveProperty('status');
    expect(discovery.selected?.ref).toBe('cap_66RTTbxhvXk41nHoMzoBy');

    await adapter.invoke({
      episodeId: 'episode-1',
      attemptId: 'attempt-unknown',
      discoveryId: discovery.discoveryId,
      capabilityRef: 'cap_66RTTbxhvXk41nHoMzoBy',
      need: 'linkedin_profile_enrichment',
      target: { subject: { name: 'Ada Lovelace', linkedinUrl: 'https://linkedin.com/in/ada' } },
      allowedDomains: ['linkedin.com'],
      budget,
      now: '2026-07-17T18:00:01.000Z',
    });

    expect(fetch.mock.calls[0]?.[0].body).toEqual({
      social_url: 'https://linkedin.com/in/ada',
      include_fields: ['name', 'job_title', 'company', 'location', 'linkedin_url', 'skills'],
    });
  });

  it('prefers the healthy OneShot profile enricher and emits only normalized public fields', async () => {
    const adapter = new ZeroVerificationAdapter({
      mode: 'recorded',
      transportLabel: 'fixture',
      transport: new FixtureZeroTransport({
        search: {
          capabilities: [
            {
              uid: 'cap_66RTTbxhvXk41nHoMzoBy',
              slug: 'data-legion-person-enrichment-api-no-pii-c084dfdf',
              canonicalName: 'Data Legion Person Enrichment API (No PII)',
              whatItDoes:
                'Enriches a public professional profile from social_url and returns selected include_fields.',
              displayCostAmount: '$0.01',
              availabilityStatus: 'unknown',
              protocol: 'x402',
            },
            {
              uid: 'cap_z5X8x5cTSVWgyP1lOaiL8',
              slug: 'oneshot-agent-linkedin-profile-enrichment-32b81ae9',
              canonicalName: 'OneShot Agent LinkedIn Profile Enrichment',
              whatItDoes: 'Enriches a LinkedIn profile with public professional fields.',
              displayCostAmount: '$0.005',
              availabilityStatus: 'healthy',
              protocol: 'x402',
              url: 'https://win.oneshotagent.com/v1/tools/enrich/profile',
            },
          ],
        },
        details: {
          cap_z5X8x5cTSVWgyP1lOaiL8: {
            uid: 'cap_z5X8x5cTSVWgyP1lOaiL8',
            slug: 'oneshot-agent-linkedin-profile-enrichment-32b81ae9',
            canonicalName: 'OneShot Agent LinkedIn Profile Enrichment',
            whatItDoes: 'Enriches a LinkedIn profile with public professional fields.',
            displayCostAmount: '$0.005',
            availabilityStatus: 'healthy',
            protocol: 'x402',
            url: 'https://win.oneshotagent.com/v1/tools/enrich/profile',
          },
        },
        fetch: {
          runId: 'oneshot-run-1',
          ok: true,
          status: 200,
          latencyMs: 90,
          payment: { amount: '0.005', asset: 'USDC' },
          body: {
            data: {
              full_name: 'Ada Lovelace',
              headline: 'Founding Engineer',
              current_company: { name: 'Analytical Engines' },
              location: 'London, UK',
              social_url: 'https://www.linkedin.com/in/ada-lovelace',
              skills: ['Mathematics', { name: 'Computing' }],
              email: 'private@example.test',
              phone: '+1-555-0100',
              contact: { personal_email: 'other@example.test' },
            },
          },
          bodyRaw: '{"data":{"full_name":"Ada Lovelace","email":"private@example.test"}}',
        },
      }),
    });

    const discovery = await adapter.discover({
      episodeId: 'episode-1',
      attemptId: 'attempt-enrich',
      need: 'linkedin_profile_enrichment',
      target: { subject: { name: 'Ada Lovelace', linkedinUrl: 'https://linkedin.com/in/ada' } },
      allowedDomains: ['linkedin.com'],
      budget,
      now: '2026-07-17T18:00:00.000Z',
    });
    expect(discovery.selected?.ref).toBe('cap_z5X8x5cTSVWgyP1lOaiL8');

    const invocation = await adapter.invoke({
      episodeId: 'episode-1',
      attemptId: 'attempt-enrich',
      discoveryId: discovery.discoveryId,
      capabilityRef: 'cap_z5X8x5cTSVWgyP1lOaiL8',
      need: 'linkedin_profile_enrichment',
      target: { subject: { name: 'Ada Lovelace', linkedinUrl: 'https://linkedin.com/in/ada' } },
      allowedDomains: ['linkedin.com'],
      budget,
      now: '2026-07-17T18:00:01.000Z',
    });

    expect(invocation.facts).toEqual(
      expect.arrayContaining([
        { key: 'full_name', value: 'Ada Lovelace', source: 'zero' },
        { key: 'job_title', value: 'Founding Engineer', source: 'zero' },
        { key: 'company', value: 'Analytical Engines', source: 'zero' },
        { key: 'location', value: 'London, UK', source: 'zero' },
        {
          key: 'linkedin_url',
          value: 'https://www.linkedin.com/in/ada-lovelace',
          source: 'zero',
        },
        { key: 'skills', value: ['Mathematics', 'Computing'], source: 'zero' },
      ]),
    );
    expect(JSON.stringify(invocation.facts)).not.toMatch(/email|phone|contact|private@example/i);
  });

  it('discovers a Zero capability, invokes only that discovered ref, and hashes evidence', async () => {
    const adapter = new ZeroVerificationAdapter({
      mode: 'fake',
      transportLabel: 'fixture',
      transport: new FixtureZeroTransport({
        search: {
          capabilities: [
            {
              token: 'z_linkedin.1',
              name: 'LinkedIn Find Profile URL',
              whatItDoes:
                'Uses AI to find a public LinkedIn profile URL given person name and context',
              cost: { amount: '$0.06' },
              availabilityStatus: 'healthy',
              protocol: 'mpp',
            },
          ],
        },
        details: {
          'z_linkedin.1': {
            uid: 'cap_linkedin',
            token: 'z_linkedin.1',
            name: 'LinkedIn Find Profile URL',
            whatItDoes:
              'Uses AI to find a public LinkedIn profile URL given person name and context with provenance',
            cost: { amount: '$0.06' },
            availabilityStatus: 'healthy',
            protocol: 'mpp',
            url: 'https://mpp.orthogonal.com/message',
            method: 'POST',
          },
        },
        fetch: {
          runId: 'run_123',
          ok: true,
          status: 200,
          latencyMs: 120,
          payment: { amount: '0.06', asset: 'USDC' },
          body: { linkedin_url: 'https://www.linkedin.com/in/ada-lovelace' },
          bodyRaw: '{"linkedin_url":"https://www.linkedin.com/in/ada-lovelace"}',
        },
      }),
    });

    const discovery = await adapter.discover({
      episodeId: 'episode-1',
      attemptId: 'attempt-1',
      need: 'linkedin_profile_url',
      target: { subject: { name: 'Ada Lovelace', company: 'Analytical Engines' } },
      allowedDomains: ['linkedin.com'],
      budget,
      now: '2026-07-17T18:00:00.000Z',
    });

    expect(discovery.selected?.ref).toBe('z_linkedin.1');

    await expect(
      adapter.invoke({
        episodeId: 'episode-1',
        attemptId: 'attempt-1',
        discoveryId: discovery.discoveryId,
        capabilityRef: 'not-discovered',
        need: 'linkedin_profile_url',
        target: { subject: { name: 'Ada Lovelace', company: 'Analytical Engines' } },
        allowedDomains: ['linkedin.com'],
        budget,
        now: '2026-07-17T18:00:01.000Z',
      }),
    ).rejects.toThrow(ZeroAdapterError);

    const invocation = await adapter.invoke({
      episodeId: 'episode-1',
      attemptId: 'attempt-1',
      discoveryId: discovery.discoveryId,
      capabilityRef: 'z_linkedin.1',
      need: 'linkedin_profile_url',
      target: { subject: { name: 'Ada Lovelace', company: 'Analytical Engines' } },
      allowedDomains: ['linkedin.com'],
      budget,
      now: '2026-07-17T18:00:01.000Z',
    });

    expect(invocation.status).toBe('success');
    expect(invocation.facts).toContainEqual({
      key: 'linkedin_profile_url',
      value: 'https://www.linkedin.com/in/ada-lovelace',
      source: 'zero',
    });
    expect(invocation.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(invocation.provider.runId).toBe('run_123');
  });
});

function capability(
  ref: string,
  name: string,
  description: string,
  declaredCostMicroUsd: number,
): ZeroCapability {
  return {
    ref,
    name,
    description,
    declaredCostMicroUsd,
    availabilityStatus: 'healthy',
    protocol: 'mpp',
    source: 'fixture',
    raw: {},
  };
}
