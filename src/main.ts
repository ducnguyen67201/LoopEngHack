import { pathToFileURL } from 'node:url';

import { readConfig, type AppConfig } from './config.js';
import type { HealthResponse, ServiceName } from './domain/types.js';

const VERSION = '0.1.0';

const serviceNameByRole = {
  arena: 'arena',
  target: null,
  'red-agent': 'red-agent',
  'white-agent': 'white-agent',
  'deploy-controller': 'deploy-controller',
  'log-bridge': 'pomerium-log-bridge',
} as const satisfies Record<AppConfig['SERVICE_ROLE'], ServiceName | null>;

export function createServiceDescriptor(config: AppConfig): HealthResponse {
  const mapped = serviceNameByRole[config.SERVICE_ROLE];
  const service =
    mapped ?? (config.TARGET_VERSION === 'v1' ? ('target-v1' as const) : ('target-v2' as const));

  return { status: 'ok', service, version: VERSION };
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  const descriptor = createServiceDescriptor(readConfig());
  process.stdout.write(`${JSON.stringify(descriptor)}\n`);
}
