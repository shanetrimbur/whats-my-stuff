import Anthropic from '@anthropic-ai/sdk';

export const ANALYSIS_SCHEMA = {
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

export const SYSTEM_PROMPT = `You are the decision engine for "What's My Stuff", a web tool that helps people declutter. The user photographs a household item and you tell them the single best thing to do with it: sell, donate, recycle, repurpose, or trash.

Ground rules:
- Judge identity, condition, and value only from what is visible in the photo. If you can't identify the item confidently, say so in the name (e.g. "unidentified small appliance") and set condition to "unknown".
- Be honest about the economics of selling. After marketplace fees (~13%), shipping materials, and the owner's time, items that would sell for under about $30 are usually a net loss to sell — recommend donating them (and give the fair market value for tax records) unless they are trivially easy to sell locally.
- "trash" is a valid answer. Don't invent value that isn't there. Broken items with no parts value and no realistic reuse should be recycled (if recyclable) or trashed.
- Value estimates are for the item as-shown, used, sold to a real buyer — not retail price, not collector fantasy.
- The listing draft should be ready to paste into eBay or Facebook Marketplace: honest, specific, mentions visible flaws.
- Repurpose ideas must be things a normal person would actually do, not craft-blog filler. Fewer honest ideas beat three forced ones.`;

export const MOCK_RESULT = {
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

export class AnalyzeError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

const ANALYZER = (process.env.ANALYZER || 'anthropic').toLowerCase();
const MOCK = process.env.MOCK_ANALYZE === '1';

let anthropicClient = null;
function getAnthropic() {
  anthropicClient ??= new Anthropic();
  return anthropicClient;
}

/**
 * Analyze a photo and return the decision-card object.
 * Provider is chosen by env: MOCK_ANALYZE=1 > ANALYZER=anthropic (default)
 * or ANALYZER=openai-compatible (any /v1/chat/completions endpoint:
 * Ollama, LM Studio, vLLM, OpenRouter — e.g. a local Hermes vision model).
 */
export async function analyzeImage(mediaType, base64Data) {
  if (MOCK) return MOCK_RESULT;
  if (ANALYZER === 'anthropic') return analyzeWithAnthropic(mediaType, base64Data);
  if (ANALYZER === 'openai-compatible' || ANALYZER === 'openai') {
    return analyzeWithOpenAICompatible(mediaType, base64Data);
  }
  throw new AnalyzeError(`Unknown ANALYZER "${ANALYZER}"`, 500);
}

async function analyzeWithAnthropic(mediaType, base64Data) {
  const response = await getAnthropic().messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
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
    throw new AnalyzeError('The analysis was declined for this image', 422);
  }
  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) throw new AnalyzeError('No analysis returned', 502);
  return JSON.parse(textBlock.text);
}

async function analyzeWithOpenAICompatible(mediaType, base64Data) {
  const baseUrl = (process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL;
  if (!model) throw new AnalyzeError('OPENAI_MODEL must be set when ANALYZER=openai-compatible', 503);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY || 'none'}`,
    },
    signal: AbortSignal.timeout(Number(process.env.ANALYZE_TIMEOUT_MS) || 180_000),
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${SYSTEM_PROMPT}\n\nRespond with ONLY a JSON object (no prose, no markdown fences) that validates against this JSON Schema:\n${JSON.stringify(ANALYSIS_SCHEMA)}`,
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64Data}` } },
            { type: 'text', text: 'Analyze this item and return the decision card JSON.' },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AnalyzeError(`Local model endpoint returned ${response.status}: ${detail.slice(0, 200)}`, 502);
  }
  const body = await response.json();
  const raw = body.choices?.[0]?.message?.content;
  if (!raw) throw new AnalyzeError('Local model returned no content', 502);
  // Local models sometimes wrap JSON in markdown fences despite instructions
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new AnalyzeError('Local model returned invalid JSON', 502);
  }
}

/** Map provider errors to HTTP-ish status codes for callers. */
export function errorToStatus(err) {
  if (err instanceof AnalyzeError) return { status: err.statusCode, message: err.message };
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 503, message: 'Server is not configured with a valid ANTHROPIC_API_KEY' };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: 'Too many requests right now — try again in a minute' };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: 'Could not reach the analysis service' };
  }
  return null;
}
