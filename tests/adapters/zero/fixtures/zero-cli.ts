#!/usr/bin/env node

const capability = {
  token: 'capture-allowed',
  uid: 'capture-uid',
  slug: 'capture-slug',
  name: 'Public Web Page Screenshot Capture',
  whatItDoes: 'Screenshot capture and scrape a public web page with provenance',
  cost: { amount: '$0.01' },
  availabilityStatus: 'healthy',
  protocol: 'x402',
};

const [command, ...args] = process.argv.slice(2);

if (command === '--version') {
  process.stdout.write('1.26.0\n');
  process.exit(0);
}

if (command === 'search') {
  process.stdout.write(JSON.stringify({ capabilities: [capability] }));
  process.exit(0);
}

if (command === 'get') {
  process.stdout.write(JSON.stringify({ ...capability, token: args[0] }));
  process.exit(0);
}

if (command === 'fetch') {
  process.stdout.write(
    JSON.stringify({
      runId: 'run-live-factory',
      ok: true,
      status: 200,
      latencyMs: 4,
      payment: { amount: '0.01', asset: 'USDC' },
      body: { captured: true },
      bodyRaw: '{"captured":true}',
    }),
  );
  process.exit(0);
}

process.stderr.write('unsupported zero fixture command\n');
process.exit(2);
