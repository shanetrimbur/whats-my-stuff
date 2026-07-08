export const id = 'discogs';

export function enabled(env = process.env) {
  return Boolean(env.DISCOGS_TOKEN);
}

export async function fetchSignals(item, { env = process.env, signal } = {}) {
  const releaseId = item.identifiers?.discogs_release_id;
  const release = releaseId
    ? await getRelease(releaseId, env, signal)
    : await searchRelease(item.search_query || item.name, env, signal);
  if (!release) return [];

  const stats = release.community ?? {};
  const median = Number(release.lowest_price);

  return [{
    marketplace: 'discogs',
    match_precision: releaseId ? 'exact' : 'similar',
    wants_count: finitePositive(stats.want),
    haves_count: finitePositive(stats.have),
    median_price: Number.isFinite(median) && median > 0 ? median : null,
    price_low: Number.isFinite(median) && median > 0 ? median : null,
    price_high: Number.isFinite(median) && median > 0 ? median : null,
    url: release.uri ? `https://www.discogs.com${release.uri}` : `https://www.discogs.com/search/?q=${encodeURIComponent(item.search_query || item.name)}&type=all`,
  }];
}

async function searchRelease(query, env, signal) {
  if (!query) return null;
  const url = new URL('https://api.discogs.com/database/search');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'release');
  url.searchParams.set('per_page', '1');
  const response = await discogsFetch(url, env, signal);
  const body = await response.json();
  const first = body.results?.[0];
  if (!first?.id) return null;
  return getRelease(first.id, env, signal);
}

async function getRelease(releaseId, env, signal) {
  const response = await discogsFetch(`https://api.discogs.com/releases/${encodeURIComponent(releaseId)}`, env, signal);
  if (!response.ok) return null;
  return response.json();
}

async function discogsFetch(url, env, signal) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Discogs token=${env.DISCOGS_TOKEN}`,
      'User-Agent': 'whats-my-stuff/0.1',
    },
    signal,
  });
  if (!response.ok) throw new Error(`Discogs request failed (${response.status})`);
  return response;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
