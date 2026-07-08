import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;
const MOCK = process.env.MOCK_ANALYZE === '1';

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

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'name', 'category', 'condition', 'est_value_low', 'est_value_high',
    'disposition', 'reasoning', 'search_query', 'listing', 'donation_fmv',
    'repurpose_ideas',
  ],
  properties: {
    name: { type: 'string', description: 'Short specific name of the item, e.g. "KitchenAid Classic stand mixer" — include brand/model if visible' },
    category: { type: 'string', description: 'Broad category, e.g. "kitchen appliance", "furniture", "electronics"' },
    condition: { type: 'string', enum: ['like new', 'good', 'fair', 'poor', 'broken', 'unknown'], description: 'Condition as judged from the photo alone' },
    est_value_low: { type: 'number', description: 'Low end of realistic used resale value in USD' },
    est_value_high: { type: 'number', description: 'High end of realistic used resale value in USD' },
    disposition: { type: 'string', enum: ['sell', 'donate', 'recycle', 'repurpose', 'trash'], description: 'The single best thing to do with this item' },
    reasoning: { type: 'string', description: '2-3 plain sentences explaining the recommendation, including the honest economics (fees, shipping, time) when relevant' },
    search_query: { type: 'string', description: 'Search query for finding sold comparable listings, e.g. "kitchenaid classic stand mixer white"' },
    listing: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'description', 'suggested_price'],
      properties: {
        title: { type: 'string', description: 'Marketplace-ready listing title, under 80 characters' },
        description: { type: 'string', description: 'Ready-to-paste listing description: what it is, condition, flaws visible in the photo' },
        suggested_price: { type: 'number', description: 'Suggested asking price in USD; 0 if disposition is not sell' },
      },
    },
    donation_fmv: { type: 'number', description: 'Approximate fair market value in USD for tax records if donated; 0 if not realistically donatable' },
    repurpose_ideas: { type: 'array', items: { type: 'string' }, description: 'Up to 3 realistic reuse/upcycle ideas; empty array if none worth doing' },
  },
};

const SYSTEM_PROMPT = `You are the decision engine for "What's My Stuff", a web tool that helps people declutter. The user photographs a household item and you tell them the single best thing to do with it: sell, donate, recycle, repurpose, or trash.

Ground rules:
- Judge identity, condition, and value only from what is visible in the photo. If you can't identify the item confidently, say so in the name (e.g. "unidentified small appliance") and set condition to "unknown".
- Be honest about the economics of selling. After marketplace fees (~13%), shipping materials, and the owner's time, items that would sell for under about $30 are usually a net loss to sell — recommend donating them (and give the fair market value for tax records) unless they are trivially easy to sell locally.
- "trash" is a valid answer. Don't invent value that isn't there. Broken items with no parts value and no realistic reuse should be recycled (if recyclable) or trashed.
- Value estimates are for the item as-shown, used, sold to a real buyer — not retail price, not collector fantasy.
- The listing draft should be ready to paste into eBay or Facebook Marketplace: honest, specific, mentions visible flaws.
- Repurpose ideas must be things a normal person would actually do, not craft-blog filler. Fewer honest ideas beat three forced ones.`;

const MOCK_RESULT = {
  name: 'Mock item (dev mode)',
  category: 'test',
  condition: 'good',
  est_value_low: 15,
  est_value_high: 40,
  disposition: 'donate',
  reasoning: 'This is a canned response from MOCK_ANALYZE=1 mode. After ~13% fees and shipping, a $25 item nets very little — donating it is the better use of your time.',
  search_query: 'mock item used',
  listing: {
    title: 'Mock item — good condition',
    description: 'Mock listing description for local development. Honest, specific, mentions flaws.',
    suggested_price: 25,
  },
  donation_fmv: 12,
  repurpose_ideas: ['Use it as a test fixture', 'Prop up a wobbly table'],
};

const anthropic = MOCK ? null : new Anthropic();

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

async function analyze(mediaType, base64Data) {
  if (MOCK) return MOCK_RESULT;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: ANALYSIS_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: 'Analyze this item and return the decision card.' },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error('The analysis was declined for this image'), { statusCode: 422 });
  }
  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) {
    throw Object.assign(new Error('No analysis returned'), { statusCode: 502 });
  }
  return JSON.parse(textBlock.text);
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
    const result = await analyze(payload.mediaType, payload.data);
    sendJson(res, 200, { result });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      sendJson(res, 503, { error: 'Server is not configured with a valid ANTHROPIC_API_KEY' });
    } else if (err instanceof Anthropic.RateLimitError) {
      sendJson(res, 429, { error: 'Too many requests right now — try again in a minute' });
    } else if (err instanceof Anthropic.APIConnectionError) {
      sendJson(res, 502, { error: 'Could not reach the analysis service' });
    } else if (err.statusCode) {
      sendJson(res, err.statusCode, { error: err.message });
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
  console.log(`What's My Stuff listening on http://localhost:${PORT}${MOCK ? ' (mock mode)' : ''}`);
});
