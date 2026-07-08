import * as keepa from './providers/keepa.js';
import * as ebayBrowse from './providers/ebay-browse.js';
import * as trends from './providers/trends.js';
import * as discogs from './providers/discogs.js';
import * as pricecharting from './providers/pricecharting.js';
import * as reverb from './providers/reverb.js';
import { scoreDemand } from './scorer.js';

export const providers = [keepa, ebayBrowse, trends, discogs, pricecharting, reverb];

const DEFAULT_TIMEOUT_MS = Number(process.env.DEMAND_TIMEOUT_MS) || 8_000;

export function enabledProviders(env = process.env) {
  return providers.filter((provider) => {
    try {
      return provider.enabled(env);
    } catch (err) {
      console.error(`demand provider ${provider.id} enabled check failed:`, err.message);
      return false;
    }
  });
}

export async function fetchDemandSignals(item, options = {}) {
  if (!item?.search_query && !item?.name) return [];
  const env = options.env ?? process.env;
  const activeProviders = options.providers ?? enabledProviders(env);
  if (activeProviders.length === 0) return [];

  const results = await Promise.all(activeProviders.map(async (provider) => {
    try {
      const signals = await provider.fetchSignals(item, {
        env,
        signal: options.signal ?? AbortSignal.timeout(Number(env.DEMAND_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
      });
      return normalizeProviderSignals(provider.id, signals);
    } catch (err) {
      console.error(`demand provider ${provider.id} failed:`, err.message);
      return [];
    }
  }));

  return results.flat();
}

export async function getWantsScores(item, options = {}) {
  const signals = await fetchDemandSignals(item, options);
  return scoreDemand(item, signals);
}

function normalizeProviderSignals(providerId, signals) {
  if (!Array.isArray(signals)) return [];
  return signals.map((signal) => ({
    provider: providerId,
    observed_at: new Date().toISOString(),
    ...signal,
  }));
}
