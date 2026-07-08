import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeImage, errorToStatus } from './lib/analyze.js';
import { getWantsScores } from './lib/demand/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;

// ~8MB request cap: a 1280px client-resized JPEG is well under 1MB as base64
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseImagePayload(body) {
  let parsed;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Body must be JSON'), { statusCode: 400 });
  }
  const image = parsed?.image;
  if (typeof image !== 'string') {
    throw Object.assign(new Error('Missing "image" field'), { statusCode: 400 });
  }
  const match = image.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/s);
  if (!match) {
    throw Object.assign(new Error('"image" must be a base64 data URL'), { statusCode: 400 });
  }
  const [, mediaType, data] = match;
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    throw Object.assign(new Error(`Unsupported image type ${mediaType}`), { statusCode: 415 });
  }
  return { mediaType, data };
}

async function handleAnalyze(req, res) {
  let payload;
  try {
    const body = await readBody(req);
    payload = parseImagePayload(body);
  } catch (err) {
    sendJson(res, err.statusCode ?? 400, { error: err.message });
    return;
  }

  try {
    const result = await analyzeImage(payload.mediaType, payload.data);
    result.wants = await getWantsScores(result);
    sendJson(res, 200, { result });
  } catch (err) {
    const mapped = errorToStatus(err);
    if (mapped) {
      sendJson(res, mapped.status, { error: mapped.message });
    } else {
      console.error('analyze failed:', err);
      sendJson(res, 500, { error: 'Analysis failed' });
    }
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let filePath = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  if (url.pathname === '/' || url.pathname === '') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }
  try {
    const content = await readFile(filePath);
    const type = MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/analyze') {
    handleAnalyze(req, res);
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
  } else {
    sendJson(res, 405, { error: 'Method not allowed' });
  }
});

server.listen(PORT, () => {
  const mode = process.env.MOCK_ANALYZE === '1' ? ' (mock mode)' : '';
  console.log(`What's My Stuff listening on http://localhost:${PORT}${mode}`);
});
