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
      RECRUITING_MCP_INTERNAL_URL: 'http://recruiting-mcp:8084/mcp',
    });
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
});
