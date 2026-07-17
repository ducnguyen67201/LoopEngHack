import { describe, expect, it } from 'vitest';

import { readConfig } from '../src/config.js';
import { createServiceDescriptor } from '../src/main.js';

describe('createServiceDescriptor', () => {
  it('maps target role and version to the frozen service name', () => {
    const config = readConfig({ SERVICE_ROLE: 'target', TARGET_VERSION: 'v2' });

    expect(createServiceDescriptor(config)).toEqual({
      status: 'ok',
      service: 'target-v2',
      version: '0.1.0',
    });
  });

  it('maps the log bridge role without exposing configuration', () => {
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
