/**
 * Market-data providers: ground the AI's value estimate in real reseller data.
 *
 * PRICING=none  (default) — skip
 * PRICING=ebay  — eBay Browse API: live comparable listings + asking-price stats
 *                 (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET, free developer tier)
 * PRICING=keepa — Keepa: Amazon price data resellers use (KEEPA_API_KEY)
 *
 * Always fails soft: any error returns null and the decision card ships
 * without market stats rather than blocking on a third-party API.
 */

const PRICING = (process.env.PRICING || 'none').toLowerCase();
const TIMEOUT_MS = Number(process.env.PRICING_TIMEOUT_MS) || 6_000;

export async function getMarketStats(query) {
  if (!query || PRICING === 'none') return null;
  try {
    if (PRICING === 'ebay') return await ebayStats(query);
    if (PRICING === 'keepa') return await keepaStats(query);
    console.error(`Unknown PRICING "${PRICING}" — skipping market stats`);
    return null;
  } catch (err) {
    console.error(`market stats (${PRICING}) failed:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------- eBay

let ebayToken = null; // { value, expiresAt }

async function getEbayToken() {
  if (ebayToken && ebayToken.expiresAt > Date.now() + 60_000) return ebayToken.value;
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set');

  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
  });
  if (!response.ok) throw new Error(`eBay token request failed (${response.status})`);
  const body = await response.json();
  ebayToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return ebayToken.value;
}

async function ebayStats(query) {
  const token = await getEbayToken();
  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '25');
  url.searchParams.set('filter', 'conditions:{USED},buyingOptions:{FIXED_PRICE}');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`eBay search failed (${response.status})`);
  const body = await response.json();

  const prices = (body.itemSummaries ?? [])
    .map((item) => Number(item.price?.value))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (prices.length < 3) return null; // too thin to be meaningful

  return {
    source: 'eBay',
    kind: 'asking', // Browse API returns live listings; sold-comps APIs are gated
    sample_size: prices.length,
    low: prices[0],
    median: prices[Math.floor(prices.length / 2)],
    high: prices[prices.length - 1],
    url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`,
  };
}

// ---------------------------------------------------------------- Keepa

async function keepaStats(query) {
  const key = process.env.KEEPA_API_KEY;
  if (!key) throw new Error('KEEPA_API_KEY not set');

  const url = new URL('https://api.keepa.com/search');
  url.searchParams.set('key', key);
  url.searchParams.set('domain', '1'); // amazon.com
  url.searchParams.set('type', 'product');
  url.searchParams.set('term', query);
  url.searchParams.set('stats', '90');

  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Keepa search failed (${response.status})`);
  const body = await response.json();

  const product = (body.products ?? []).find((p) => p.stats);
  if (!product) return null;

  // Keepa prices are integer cents; index 1 = NEW, 2 = USED; -1 = no data
  const centsOf = (arr, idx) => (Array.isArray(arr) && arr[idx] > 0 ? arr[idx] / 100 : null);
  const usedNow = centsOf(product.stats.current, 2);
  const newNow = centsOf(product.stats.current, 1);
  const usedAvg90 = centsOf(product.stats.avg90, 2);
  const price = usedNow ?? newNow;
  if (!price) return null;

  return {
    source: 'Amazon (Keepa)',
    kind: usedNow ? 'used' : 'new',
    sample_size: 1,
    low: usedAvg90 ? Math.min(price, usedAvg90) : price,
    median: price,
    high: usedAvg90 ? Math.max(price, usedAvg90) : price,
    url: `https://keepa.com/#!search/1-${encodeURIComponent(query)}`,
    matched_title: product.title,
    asin: product.asin,
  };
}
