export const id = 'keepa';

export function enabled(env = process.env) {
  return Boolean(env.KEEPA_API_KEY);
}

export async function fetchSignals(item, { env = process.env, signal } = {}) {
  const key = env.KEEPA_API_KEY;
  if (!key) return [];

  const query = item.identifiers?.asin || item.identifiers?.upc || item.search_query || item.name;
  if (!query) return [];

  const url = new URL('https://api.keepa.com/search');
  url.searchParams.set('key', key);
  url.searchParams.set('domain', '1');
  url.searchParams.set('type', 'product');
  url.searchParams.set('term', query);
  url.searchParams.set('stats', '90');

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Keepa search failed (${response.status})`);
  const body = await response.json();
  const product = (body.products ?? []).find((candidate) => candidate.stats);
  if (!product) return [];

  const usedNow = centsOf(product.stats.current, 2);
  const newNow = centsOf(product.stats.current, 1);
  const usedAvg90 = centsOf(product.stats.avg90, 2);
  const medianPrice = usedNow ?? newNow ?? usedAvg90;
  if (!medianPrice) return [];

  const velocity = finitePositive(product.monthlySold)
    ?? finitePositive(product.stats.salesRankDrops30)
    ?? (finitePositive(product.stats.salesRankDrops90) != null ? product.stats.salesRankDrops90 / 3 : null);
  const activeSupply = finitePositive(product.offers)
    ?? finitePositive(product.stats.current?.[11])
    ?? null;

  return [{
    marketplace: 'amazon',
    match_precision: isExact(item, product) ? 'exact' : 'similar',
    velocity_units_per_month: velocity,
    active_supply: activeSupply,
    median_price: medianPrice,
    price_low: usedAvg90 ? Math.min(medianPrice, usedAvg90) : medianPrice,
    price_high: usedAvg90 ? Math.max(medianPrice, usedAvg90) : medianPrice,
    trend_slope_90d: trendFromAverages(product.stats),
    url: product.asin
      ? `https://keepa.com/#!product/1-${encodeURIComponent(product.asin)}`
      : `https://keepa.com/#!search/1-${encodeURIComponent(query)}`,
  }];
}

function centsOf(arr, idx) {
  return Array.isArray(arr) && arr[idx] > 0 ? arr[idx] / 100 : null;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isExact(item, product) {
  const asin = item.identifiers?.asin?.toUpperCase();
  if (asin && asin === product.asin) return true;
  const upc = item.identifiers?.upc;
  return Boolean(upc && Array.isArray(product.upcList) && product.upcList.includes(upc));
}

function trendFromAverages(stats) {
  const avg30 = centsOf(stats?.avg30, 2) ?? centsOf(stats?.avg30, 1);
  const avg90 = centsOf(stats?.avg90, 2) ?? centsOf(stats?.avg90, 1);
  if (!avg30 || !avg90) return null;
  return Math.max(-1, Math.min(1, (avg30 - avg90) / avg90));
}
