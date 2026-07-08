import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import test from 'node:test';

const SAMPLE_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==';

test('mock analyze endpoint returns the P1 decision-card envelope', async (t) => {
  const port = await freePort();
  const server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MOCK_ANALYZE: '1',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk.toString(); });
  server.stderr.on('data', (chunk) => { output += chunk.toString(); });

  t.after(() => {
    if (!server.killed) server.kill();
  });

  await waitFor(() => output.includes(`http://localhost:${port}`), () => output);

  const response = await fetch(`http://localhost:${port}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: SAMPLE_JPEG }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.name, 'Mock item (dev mode)');
  assert.equal(body.result.match_precision, 'category');
  assert.equal(body.result.shipping_class, 'small');
  assert.deepEqual(body.result.identifiers, {
    model: '',
    upc: '',
    asin: '',
    epid: '',
    discogs_release_id: '',
    pricecharting_id: '',
  });
  assert.deepEqual(body.result.wants, []);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(predicate, debugOutput) {
  const started = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - started > 5_000) {
      throw new Error(`Timed out waiting for server startup:\n${debugOutput()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
