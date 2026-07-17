import { pathToFileURL } from 'node:url';

import { createHttpApp } from './http.js';

export function startStandaloneServer(env: NodeJS.ProcessEnv = process.env) {
  const port = Number.parseInt(env.PORT ?? '8080', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const app = createHttpApp();
  return app.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Recruiting stream UI: http://127.0.0.1:${port}/?mode=live\n`);
  });
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  const server = startStandaloneServer();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
