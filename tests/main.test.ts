import { describe, expect, it } from 'vitest';

import { readConfig } from '../src/config.js';
import { createServiceDescriptor } from '../src/main.js';

describe('createServiceDescriptor', () => {
  it('maps the vendor-neutral recruiting MCP role', () => {
    const config = readConfig({
      SERVICE_ROLE: 'recruiting-mcp',
      INTERNAL_AGENT_TOKEN: 'internal-agent-token-for-main-test',
    });

    expect(createServiceDescriptor(config)).toEqual({
      status: 'ok',
      service: 'recruiting-mcp',
      version: '0.1.0',
    });
  });

  it('maps the Pomerium log bridge without exposing configuration', () => {
    const config = readConfig({
      SERVICE_ROLE: 'log-bridge',
      LOG_BRIDGE_TOKEN: 'log-bridge-token-for-main-test',
    });

    expect(createServiceDescriptor(config)).toEqual({
      status: 'ok',
      service: 'pomerium-log-bridge',
      version: '0.1.0',
    });
  });
});
