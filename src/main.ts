import { pathToFileURL } from 'node:url';

import { readConfig, type AppConfig } from './config.js';
import type { HealthResponse, ServiceName } from './domain/types.js';
import { startArenaServer } from './server/http.js';

const VERSION = '0.1.0';

const serviceNameByRole = {
  arena: 'arena',
  'outbound-sourcer': 'outbound-sourcer',
  'white-verifier': 'white-verifier',
  'hiring-controller': 'hiring-controller',
  'recruiting-mcp': 'recruiting-mcp',
  'log-bridge': 'pomerium-log-bridge',
} as const satisfies Record<AppConfig['SERVICE_ROLE'], ServiceName>;

export function createServiceDescriptor(config: AppConfig): HealthResponse {
  return { status: 'ok', service: serviceNameByRole[config.SERVICE_ROLE], version: VERSION };
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  const config = readConfig();
  if (config.SERVICE_ROLE === 'arena') {
    startArenaServer(config);
  } else {
    const descriptor = createServiceDescriptor(config);
    process.stdout.write(`${JSON.stringify(descriptor)}\n`);
  }
}
