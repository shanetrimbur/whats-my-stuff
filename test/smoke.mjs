/**
 * Smoke test: boots the server in mock mode, exercises the API surface,
 * then (if a Chromium executable is available) drives the real UI flow
 * headlessly — photo upload, decision card, history, sell-branch rendering.
 *
 *   npm test
 *
 * Browser step: set CHROME_PATH to a Chromium/Chrome executable, or run
 * `npx playwright-core install chromium` equivalent. Without one, the
 * browser step is skipped with a warning (API checks still gate).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
}

// 1x1 JPEG for API tests, 1x1 PNG for the browser upload
const TINY_JPEG = '/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const server = spawn('node', ['server.js'], {
  env: { ...process.env, MOCK_ANALYZE: '1', PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => { if (String(chunk).includes('listening')) resolve(); });
  server.on('exit', (code) => reject(new Error(`server exited early (${code})`)));
  setTimeout(() => reject(new Error('server did not start within 5s')), 5000);
});

try {
  // ------------------------------------------------------------ API checks
  const index = await fetch(`${BASE}/`);
  check('GET / serves index.html', index.status === 200 && (await index.text()).includes('What\'s My Stuff'));

  for (const asset of ['/css/style.css', '/js/app.js']) {
    check(`GET ${asset}`, (await fetch(`${BASE}${asset}`)).status === 200);
  }

  const analyze = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: `data:image/jpeg;base64,${TINY_JPEG}` }),
  });
  const body = await analyze.json();
  check('POST /api/analyze (mock) returns decision card', analyze.status === 200 && typeof body.result?.name === 'string'
    && ['sell', 'donate', 'recycle', 'repurpose', 'trash'].includes(body.result?.disposition), JSON.stringify(body).slice(0, 120));

  const bad = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: 'not-a-data-url' }),
  });
  check('POST /api/analyze rejects bad payload with 400', bad.status === 400);

  const gif = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: 'data:image/gif;base64,AAAA' }),
  });
  check('POST /api/analyze rejects unsupported media type with 415', gif.status === 415);

  const traversal = await fetch(`${BASE}/..%2Fserver.js`);
  check('path traversal is blocked', traversal.status === 403 || traversal.status === 404);

  // ------------------------------------------------------------ browser checks
  const chromePath = [
    process.env.CHROME_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean).find((p) => existsSync(p));

  if (!chromePath) {
    console.log('skip  browser checks — no Chromium found (set CHROME_PATH)');
  } else {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

    await page.goto(BASE);
    await page.setInputFiles('#photo-input', { name: 'item.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG, 'base64') });
    await page.waitForSelector('#result .card', { timeout: 10_000 });
    check('browser: photo upload renders decision card', (await page.textContent('#result .card')).length > 50);

    await page.setInputFiles('#photo-input', { name: 'item2.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG, 'base64') });
    await page.waitForSelector('#history .history-item', { timeout: 10_000 });
    check('browser: history accumulates', (await page.locator('#history .history-item').count()) >= 1);

    // Sell branch + market stats via intercepted response
    const sellResult = {
      name: 'Test mixer', category: 'kitchen appliance', condition: 'good',
      est_value_low: 120, est_value_high: 180, disposition: 'sell',
      reasoning: 'test', search_query: 'test mixer',
      listing: { title: 'Test mixer', description: 'desc', suggested_price: 150 },
      donation_fmv: 60, repurpose_ideas: [],
      market: { source: 'eBay', kind: 'asking', sample_size: 24, low: 95, median: 142, high: 210, url: 'https://example.com' },
    };
    await page.route('**/api/analyze', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ result: sellResult }) }));
    await page.setInputFiles('#photo-input', { name: 'mixer.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG, 'base64') });
    await page.waitForSelector('.listing-draft', { timeout: 10_000 });
    check('browser: sell branch renders listing draft + copy button', (await page.locator('#result button:has-text("Copy listing")').count()) === 1);
    check('browser: market stats line renders', (await page.locator('#result .market').count()) === 1);
    check('browser: no page errors', pageErrors.length === 0, pageErrors.join('; '));

    await browser.close();
  }
} finally {
  server.kill();
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
