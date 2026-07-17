import { describe, expect, it } from 'vitest';

import { readConfig } from '../src/config.js';

const internalToken = 'internal-agent-token-for-contract-tests';
const bridgeToken = 'log-bridge-token-for-contract-tests';

describe('readConfig', () => {
  it('loads safe Arena defaults and validates its internal tokens', () => {
    const config = readConfig({
      SERVICE_ROLE: 'arena',
      INTERNAL_AGENT_TOKEN: internalToken,
      LOG_BRIDGE_TOKEN: bridgeToken,
    });

    expect(config).toMatchObject({
      SERVICE_ROLE: 'arena',
      PORT: 8080,
      DEMO_MODE: 'fake',
      ZERO_MODE: 'fake',
      RECRUITING_OPS_MODE: 'fake',
      CALENDAR_MODE: 'memory',
      RECRUITING_MCP_INTERNAL_URL: 'http://recruiting-mcp:8084/mcp',
    });
  });

  it('refuses to label an Arena live unless every real adapter is selected', () => {
    expect(() =>
      readConfig({
        ...protectedArenaEnvironment(),
        DEMO_MODE: 'live',
      }),
    ).toThrow(/ZERO_MODE must be live/);
  });

  it('accepts a fully configured credential-gated live pipeline', () => {
    const config = readConfig({
      ...protectedArenaEnvironment(),
      DEMO_MODE: 'live',
      ZERO_MODE: 'live',
      ZERO_ALLOWED_CAPABILITY_REFS: 'public-page.capture.v1',
      ZERO_ALLOWED_TARGET_DOMAINS: 'portfolio.example.com',
      ZERO_TARGET_BASE_URL: 'https://portfolio.example.com/claims/',
      RECRUITING_OPS_MODE: 'http',
      OUTBOUND_RECRUITING_BASE_URL: 'https://ats-sandbox.example.com/',
      OUTBOUND_RECRUITING_BEARER_TOKEN: 'outbound-token-at-least-24-characters',
      CALENDAR_MODE: 'google',
      GOOGLE_CALENDAR_OAUTH_ACCESS_TOKEN: 'calendar-token-at-least-24-characters',
      GOOGLE_CALENDAR_SANDBOX_ID: 'team-sandbox@example.com',
      SANDBOX_CALENDAR_ATTENDEE_EMAIL: 'controlled-candidate@example.com',
      SANDBOX_SCREEN_START_AT: '2026-07-18T18:00:00Z',
      SANDBOX_SCREEN_END_AT: '2026-07-18T18:30:00Z',
    });

    expect(config).toMatchObject({
      DEMO_MODE: 'live',
      ZERO_MODE: 'live',
      RECRUITING_OPS_MODE: 'http',
      CALENDAR_MODE: 'google',
      ZERO_ALLOWED_CAPABILITY_REFS: ['public-page.capture.v1'],
    });
  });

  it('requires HTTPS for configured live data-plane targets', () => {
    expect(() =>
      readConfig({
        ZERO_MODE: 'live',
        ZERO_ALLOWED_CAPABILITY_REFS: 'public-page.capture.v1',
        ZERO_ALLOWED_TARGET_DOMAINS: 'portfolio.example.com',
        ZERO_TARGET_BASE_URL: 'http://portfolio.example.com/claims/',
      }),
    ).toThrow(/must use HTTPS/);
    expect(() =>
      readConfig({
        RECRUITING_OPS_MODE: 'http',
        OUTBOUND_RECRUITING_BASE_URL: 'http://ats-sandbox.example.com/',
        OUTBOUND_RECRUITING_BEARER_TOKEN: 'outbound-token-at-least-24-characters',
      }),
    ).toThrow(/must use HTTPS/);
  });

  it('requires only the selected recruiting identity credentials', () => {
    const config = readConfig({
      SERVICE_ROLE: 'outbound-sourcer',
      INTERNAL_AGENT_TOKEN: internalToken,
      SOURCER_MCP_URL: 'https://sourcer-mcp.example.invalid/mcp',
      SOURCER_POMERIUM_JWT: 'sourcer-service-account-jwt-for-tests',
    });

    expect(config.SOURCER_POMERIUM_JWT).toBe('sourcer-service-account-jwt-for-tests');
    expect(config.VERIFIER_POMERIUM_JWT).toBeUndefined();
  });

  it('fails fast with a variable name and never echoes another secret', () => {
    expect(() =>
      readConfig({
        SERVICE_ROLE: 'white-verifier',
        INTERNAL_AGENT_TOKEN: internalToken,
        VERIFIER_MCP_URL: 'https://verifier-mcp.example.invalid/mcp',
        SOURCER_POMERIUM_JWT: 'sourcer-secret-that-must-not-appear',
      }),
    ).toThrow(/VERIFIER_POMERIUM_JWT is required/);

    try {
      readConfig({
        SERVICE_ROLE: 'white-verifier',
        INTERNAL_AGENT_TOKEN: internalToken,
        VERIFIER_MCP_URL: 'https://verifier-mcp.example.invalid/mcp',
        SOURCER_POMERIUM_JWT: 'sourcer-secret-that-must-not-appear',
      });
    } catch (error) {
      expect(String(error)).not.toContain('sourcer-secret-that-must-not-appear');
    }
  });

  it('normalizes blank optional credentials to missing', () => {
    expect(() =>
      readConfig({
        SERVICE_ROLE: 'outbound-sourcer',
        INTERNAL_AGENT_TOKEN: internalToken,
        SOURCER_MCP_URL: ' ',
        SOURCER_POMERIUM_JWT: ' ',
      }),
    ).toThrow(/SOURCER_MCP_URL is required/);
  });

  it('keeps loop closure disabled until explicitly enabled', () => {
    const config = readConfig({
      ELEVENLABS_API_KEY: 'elevenlabs-api-key-for-contract-tests',
    });

    expect(config.ELEVENLABS_LOOP_CLOSURE_ENABLED).toBe(false);
    expect(config.ELEVENLABS_API_KEY).toBe('elevenlabs-api-key-for-contract-tests');
  });

  it('requires complete phone and webhook configuration when loop closure is enabled', () => {
    expect(() =>
      readConfig({
        ELEVENLABS_LOOP_CLOSURE_ENABLED: 'true',
        ELEVENLABS_API_KEY: 'elevenlabs-api-key-for-contract-tests',
      }),
    ).toThrow(/INTERNAL_AGENT_TOKEN is required/);

    expect(
      readConfig({
        ELEVENLABS_LOOP_CLOSURE_ENABLED: 'true',
        INTERNAL_AGENT_TOKEN: 'operator-token-at-least-24-characters',
        ELEVENLABS_API_KEY: 'elevenlabs-api-key-for-contract-tests',
        ELEVENLABS_AGENT_ID: 'agent-phone-test',
        ELEVENLABS_PHONE_NUMBER_ID: 'phone-number-test',
        ELEVENLABS_TO_NUMBER: '+14155550123',
        ELEVENLABS_WEBHOOK_SECRET: 'elevenlabs-webhook-secret-for-tests',
      }),
    ).toMatchObject({
      ELEVENLABS_LOOP_CLOSURE_ENABLED: true,
      ELEVENLABS_TO_NUMBER: '+14155550123',
    });
  });
});

function protectedArenaEnvironment(): Record<string, string> {
  return {
    SERVICE_ROLE: 'arena',
    INTERNAL_AGENT_TOKEN: internalToken,
    SOURCER_MCP_URL: 'https://sourcer.example.test/mcp',
    CONTROLLER_MCP_URL: 'https://controller.example.test/mcp',
    SOURCER_POMERIUM_JWT: 'sourcer-jwt-at-least-24-characters',
    CONTROLLER_POMERIUM_JWT: 'controller-jwt-at-least-24-characters',
    POMERIUM_JWKS_URL: 'https://arena.example.test/.well-known/pomerium/jwks.json',
    POMERIUM_ISSUER: 'https://auth.example.test',
    POMERIUM_AUDIENCE: 'https://arena.example.test',
    POMERIUM_SOURCER_SUBJECT: 'sourcer-service-account',
    POMERIUM_CONTROLLER_SUBJECT: 'controller-service-account',
  };
}
