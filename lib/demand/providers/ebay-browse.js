export const id = 'ebay-browse';

let tokenCache = null;

export function enabled(env = process.env) {
  return Boolean(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET);
}

export async function fetchSignals(item, { env = process.env, signal } = {}) {
  const query = item.identifiers?.upc || item.identifiers?.model || item.search_query || item.name;
  if (!query) return [];

  const token = await getToken(env, signal);
  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '50');
  url.searchParams.set('filter', 'conditions:{USED},buyingOptions:{FIXED_PRICE}');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
    signal,
  });
  if (!response.ok) throw new Error(`eBay Browse search failed (${response.status})`);

  const body = await response.json();
  const prices = (body.itemSummaries ?? [])
    .map((listing) => Number(listing.price?.value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (prices.length < 3) return [];

  return [{
    marketplace: 'ebay',
    match_precision: item.identifiers?.upc || item.identifiers?.model ? 'exact' : 'similar',
    active_supply: Number.isFinite(Number(body.total)) ? Number(body.total) : prices.length,
    median_price: prices[Math.floor(prices.length / 2)],
    price_low: prices[0],
    price_high: prices[prices.length - 1],
    url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`,
  }];
}

async function getToken(env, signal) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString('base64')}`,
    },
    signal,
    body: `grant_type=client_credentials&scope=${encodeURIComponent('https://api.ebay.com/oauth/api_scope')}`,
  });
  if (!response.ok) throw new Error(`eBay token request failed (${response.status})`);
  const body = await response.json();
  tokenCache = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in) * 1000 };
  return tokenCache.value;
}
