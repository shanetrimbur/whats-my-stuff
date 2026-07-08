export const id = 'pricecharting';

export function enabled(env = process.env) {
  return Boolean(env.PRICECHARTING_API_KEY);
}

export async function fetchSignals(item, { env = process.env, signal } = {}) {
  const productId = item.identifiers?.pricecharting_id;
  const query = productId || item.search_query || item.name;
  if (!query) return [];

  const url = new URL('https://www.pricecharting.com/api/product');
  url.searchParams.set('t', env.PRICECHARTING_API_KEY);
  if (productId) {
    url.searchParams.set('id', productId);
  } else {
    url.searchParams.set('q', query);
  }

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`PriceCharting request failed (${response.status})`);
  const body = await response.json();
  if (body.status && body.status !== 'success') return [];

  const loose = cents(body['loose-price']);
  const cib = cents(body['cib-price']);
  const newPrice = cents(body['new-price']);
  const median = loose ?? cib ?? newPrice;
  if (!median) return [];

  const name = body['product-name'] || query;
  return [{
    marketplace: 'pricecharting',
    match_precision: productId ? 'exact' : 'similar',
    velocity_units_per_month: finitePositive(body['sales-volume']),
    wants_count: finitePositive(body['wishlist-count']),
    median_price: median,
    price_low: Math.min(...[loose, cib, newPrice].filter(Boolean)),
    price_high: Math.max(...[loose, cib, newPrice].filter(Boolean)),
    url: body['product-url'] || `https://www.pricecharting.com/search-products?q=${encodeURIComponent(name)}&type=prices`,
  }];
}

function cents(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number / 100 : null;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
