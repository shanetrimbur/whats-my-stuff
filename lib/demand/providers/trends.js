export const id = 'trends';

export function enabled(env = process.env) {
  return env.TRENDS_ENABLED === '1';
}

export async function fetchSignals() {
  // Google Trends has no stable official API. Keep this provider in the registry
  // so a legal Trends backend can be added without changing the scorer contract.
  return [];
}
