import { fileURLToPath } from 'node:url';

import express from 'express';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const publicRoot = fileURLToPath(new URL('../public', import.meta.url));
const fixturePath = fileURLToPath(
  new URL('../fixtures/recruiting-contract-events.json', import.meta.url),
);
const port = Number.parseInt(process.env.DEMO_UI_PORT ?? '4173', 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('DEMO_UI_PORT must be an integer between 1 and 65535');
}

const app = express();

app.disable('x-powered-by');
app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'recruiting-demo-ui' });
});
app.get('/fixtures/recruiting-contract-events.json', (_request, response) => {
  response.sendFile(fixturePath, { dotfiles: 'allow' });
});
app.use(express.static(publicRoot, { extensions: ['html'] }));
app.get('*path', (_request, response) => {
  response.sendFile(`${publicRoot}/index.html`, { dotfiles: 'allow' });
});

app.listen(port, '127.0.0.1', () => {
  process.stdout.write(
    `Hire Me If You Can demo: http://127.0.0.1:${port}\nProject: ${projectRoot}\n`,
  );
});
