export const id = 'reverb';

export function enabled(env = process.env) {
  return Boolean(env.REVERB_TOKEN);
}

export async function fetchSignals(item, { env = process.env, signal } = {}) {
  const query = item.search_query || item.name;
  if (!query) return [];

  const url = new URL('https://api.reverb.com/api/listings');
  url.searchParams.set('query', query);
  url.searchParams.set('condition', 'used');
  url.searchParams.set('per_page', '25');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.REVERB_TOKEN}`,
      'Accept-Version': '3.0',
    },
    signal,
  });
  if (!response.ok) throw new Error(`Reverb listings request failed (${response.status})`);

  const body = await response.json();
  const prices = (body.listings ?? [])
    .map((listing) => Number(listing.price?.amount))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (prices.length < 3) return [];

  return [{
    marketplace: 'reverb',
    match_precision: item.identifiers?.model ? 'exact' : 'similar',
    active_supply: Number.isFinite(Number(body.total)) ? Number(body.total) : prices.length,
    median_price: prices[Math.floor(prices.length / 2)],
    price_low: prices[0],
    price_high: prices[prices.length - 1],
    url: `https://reverb.com/marketplace?query=${encodeURIComponent(query)}`,
  }];
}
