import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import express from 'express';

const host = '127.0.0.1';
const port = Number.parseInt(process.env.DEMO_PORT ?? '4173', 10);
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('DEMO_PORT must be an integer between 1 and 65535');
}

const app = express();
app.disable('x-powered-by');
app.use(express.static(publicDirectory, { extensions: ['html'] }));

// INTEGRATION(pipeline-runtime): the merged runtime may serve this same public directory, but the
// offline fixture launcher must remain independent so the three-minute demo has a safe fallback.
const server = app.listen(port, host, () => {
  const url = `http://${host}:${port}/?autoplay=1`;
  process.stdout.write(`Hire Me If You Can demo: ${url}\n`);
  process.stdout.write('Fixture mode only — no live sponsor service will be contacted.\n');

  if (process.env.DEMO_NO_OPEN !== '1') openBrowser(url);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? { executable: 'open', arguments: [url] }
      : process.platform === 'win32'
        ? { executable: 'cmd', arguments: ['/c', 'start', '', url] }
        : { executable: 'xdg-open', arguments: [url] };

  const child = spawn(command.executable, command.arguments, {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => {
    process.stderr.write(`Could not open a browser automatically. Open ${url} manually.\n`);
  });
  child.unref();
}
