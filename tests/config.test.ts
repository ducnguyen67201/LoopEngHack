import { describe, expect, it } from 'vitest';

import { readConfig } from '../src/config.js';

const internalToken = 'internal-agent-token-for-contract-tests';
const bridgeToken = 'log-bridge-token-for-contract-tests';

describe('readConfig', () => {
  it('loads Arena defaults and validates its two internal tokens', () => {
    const config = readConfig({
      SERVICE_ROLE: 'arena',
      INTERNAL_AGENT_TOKEN: internalToken,
      LOG_BRIDGE_TOKEN: bridgeToken,
    });

    expect(config).toMatchObject({
      SERVICE_ROLE: 'arena',
      PORT: 8080,
      DEMO_MODE: 'live',
      TARGET_V1_URL: 'http://target-v1:8081',
      TARGET_V2_URL: 'http://target-v2:8081',
    });
  });

  it('requires only the selected agent role credentials', () => {
    const config = readConfig({
      SERVICE_ROLE: 'red-agent',
      INTERNAL_AGENT_TOKEN: internalToken,
      RED_MCP_URL: 'https://red-mcp.example.invalid/mcp',
      RED_POMERIUM_JWT: 'red-service-account-jwt-for-tests',
    });

    expect(config.RED_POMERIUM_JWT).toBe('red-service-account-jwt-for-tests');
    expect(config.WHITE_POMERIUM_JWT).toBeUndefined();
  });

  it('fails fast with a variable name and never echoes another secret', () => {
    expect(() =>
      readConfig({
        SERVICE_ROLE: 'white-agent',
        INTERNAL_AGENT_TOKEN: internalToken,
        WHITE_MCP_URL: 'https://white-mcp.example.invalid/mcp',
        RED_POMERIUM_JWT: 'red-secret-that-must-not-appear',
      }),
    ).toThrow(/WHITE_POMERIUM_JWT is required/);

    try {
      readConfig({
        SERVICE_ROLE: 'white-agent',
        INTERNAL_AGENT_TOKEN: internalToken,
        WHITE_MCP_URL: 'https://white-mcp.example.invalid/mcp',
        RED_POMERIUM_JWT: 'red-secret-that-must-not-appear',
      });
    } catch (error) {
      expect(String(error)).not.toContain('red-secret-that-must-not-appear');
    }
  });

  it('normalizes blank optional credentials to missing', () => {
    expect(() =>
      readConfig({
        SERVICE_ROLE: 'red-agent',
        INTERNAL_AGENT_TOKEN: internalToken,
        RED_MCP_URL: ' ',
        RED_POMERIUM_JWT: ' ',
      }),
    ).toThrow(/RED_MCP_URL is required/);
  });
});
