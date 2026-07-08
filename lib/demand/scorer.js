const WEIGHTS = { V: 0.4, L: 0.3, B: 0.2, M: 0.1 };
const MATCH_PRECISION_RANK = { category: 0, similar: 1, exact: 2 };
const SCORE_BANDS = [
  { min: 70, label: 'in demand - sell it' },
  { min: 40, label: 'sells, be patient' },
  { min: 15, label: 'thin market' },
  { min: 0, label: "nobody's buying - donate/recycle" },
];

const MARKETPLACE_FEE_RATES = {
  amazon: 0.15,
  ebay: 0.136,
  discogs: 0.09,
  reverb: 0.082,
  pricecharting: 0.129,
  local: 0,
  web: 0,
};

const SHIPPING_COST_ESTIMATES = {
  small: 6,
  medium: 14,
  large: 32,
  'bulky-freight': 0,
  unknown: 14,
};

const SHIPPED_MARKETPLACES = new Set(['amazon', 'ebay', 'discogs', 'reverb', 'pricecharting']);

export function scoreDemand(item, signals) {
  const normalized = normalizeSignals(signals);
  if (normalized.length === 0) return [];

  const marketplacesPresent = new Set(normalized.map((signal) => signal.marketplace)).size;
  const signalsByMarketplace = Map.groupBy
    ? Map.groupBy(normalized, (signal) => signal.marketplace)
    : groupByMarketplace(normalized);

  return [...signalsByMarketplace.entries()]
    .map(([marketplace, marketplaceSignals]) => scoreMarketplace(item, marketplace, marketplaceSignals, marketplacesPresent))
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.net_proceeds_est ?? -Infinity) - (a.net_proceeds_est ?? -Infinity);
    });
}

function groupByMarketplace(signals) {
  const grouped = new Map();
  for (const signal of signals) {
    const existing = grouped.get(signal.marketplace) ?? [];
    existing.push(signal);
    grouped.set(signal.marketplace, existing);
  }
  return grouped;
}

function scoreMarketplace(item, marketplace, signals, marketplacesPresent) {
  const matchPrecision = bestMatchPrecision(signals);
  const components = {
    V: velocityComponent(signals),
    L: liquidityComponent(signals),
    B: breadthComponent(signals, marketplacesPresent),
    M: momentumComponent(signals),
  };
  const usable = Object.entries(components).filter(([, value]) => value != null);
  const score = matchPrecision === 'category' || usable.length === 0
    ? null
    : Math.round(100 * usable.reduce((sum, [key, value]) => sum + value * WEIGHTS[key], 0) / usable.reduce((sum, [key]) => sum + WEIGHTS[key], 0));

  const medianPrice = medianNumber(signals.map((signal) => signal.median_price));
  const shippingClass = normalizeShippingClass(item?.shipping_class);
  const canShip = shippingClass !== 'bulky-freight' || !SHIPPED_MARKETPLACES.has(marketplace);
  const netProceeds = canShip && medianPrice != null
    ? roundCurrency(medianPrice * (1 - (MARKETPLACE_FEE_RATES[marketplace] ?? 0.13)) - (SHIPPING_COST_ESTIMATES[shippingClass] ?? SHIPPING_COST_ESTIMATES.unknown))
    : null;
  const daysToSale = estimateDaysToSale(signals);
  const grade = confidenceGrade(matchPrecision, signals);

  return {
    marketplace,
    score,
    band: score == null ? 'not enough market data' : bandForScore(score),
    grade,
    days_to_sale_p50: daysToSale,
    days_to_sale_label: daysLabel(daysToSale),
    net_proceeds_est: netProceeds,
    components: Object.fromEntries(Object.entries(components).filter(([, value]) => value != null)),
    match_precision: matchPrecision,
    sources: buildSources(signals),
    headline: headlineFor({ marketplace, score, grade, netProceeds, daysToSale, canShip }),
  };
}

function normalizeSignals(signals) {
  if (!Array.isArray(signals)) return [];
  return signals
    .map((signal) => ({
      ...signal,
      marketplace: normalizeMarketplace(signal.marketplace),
      match_precision: normalizeMatchPrecision(signal.match_precision),
      observed_at: signal.observed_at || new Date().toISOString(),
    }))
    .filter((signal) => signal.provider && signal.marketplace && signal.match_precision);
}

function normalizeMarketplace(marketplace) {
  return typeof marketplace === 'string' ? marketplace.trim().toLowerCase() : '';
}

function normalizeMatchPrecision(matchPrecision) {
  return MATCH_PRECISION_RANK[matchPrecision] != null ? matchPrecision : 'category';
}

function normalizeShippingClass(value) {
  return SHIPPING_COST_ESTIMATES[value] != null ? value : 'unknown';
}

function velocityComponent(signals) {
  const value = maxNumber(signals.map((signal) => signal.velocity_units_per_month));
  if (value == null) return null;
  if (value <= 0) return 0;
  if (value < 1) return value * 0.35;
  if (value <= 10) return 0.35 + Math.log10(value) * 0.3;
  if (value >= 100) return 1;
  return 0.65 + (Math.log10(value) - 1) * 0.35;
}

function liquidityComponent(signals) {
  const explicitRatios = signals
    .map((signal) => {
      const wants = finitePositive(signal.wants_count);
      const haves = finitePositive(signal.haves_count);
      return wants != null && haves != null ? wants / haves : null;
    })
    .filter((value) => value != null);
  const sellThroughRatios = signals
    .map((signal) => {
      const velocity = finitePositive(signal.velocity_units_per_month);
      const supply = finitePositive(signal.active_supply);
      return velocity != null && supply != null ? velocity / supply : null;
    })
    .filter((value) => value != null);
  const ratio = maxNumber([...explicitRatios, ...sellThroughRatios]);
  if (ratio == null) return null;
  if (ratio >= 1) return 1;
  if (ratio >= 0.5) return interpolate(ratio, 0.5, 1, 0.75, 1);
  if (ratio >= 0.2) return interpolate(ratio, 0.2, 0.5, 0.5, 0.75);
  if (ratio <= 0.05) return 0.1;
  return interpolate(ratio, 0.05, 0.2, 0.1, 0.5);
}

function breadthComponent(signals, marketplacesPresent) {
  const searchInterest = maxNumber(signals.map((signal) => signal.search_interest));
  const presence = clamp(marketplacesPresent / 6, 0, 1);
  if (searchInterest == null) return presence;
  return clamp((searchInterest / 100) * 0.5 + presence * 0.5, 0, 1);
}

function momentumComponent(signals) {
  const slope = maxNumber(signals.map((signal) => signal.trend_slope_90d));
  return slope == null ? null : clamp((slope + 1) / 2, 0, 1);
}

function confidenceGrade(matchPrecision, signals) {
  if (matchPrecision === 'category') return 'D';
  if (matchPrecision === 'similar') return 'C';
  const velocityProviders = new Set(signals
    .filter((signal) => finitePositive(signal.velocity_units_per_month) != null)
    .map((signal) => signal.provider));
  return velocityProviders.size >= 2 ? 'A' : 'B';
}

function bestMatchPrecision(signals) {
  return signals.reduce((best, signal) => (
    MATCH_PRECISION_RANK[signal.match_precision] > MATCH_PRECISION_RANK[best] ? signal.match_precision : best
  ), 'category');
}

function estimateDaysToSale(signals) {
  const ratios = signals
    .map((signal) => {
      const velocity = finitePositive(signal.velocity_units_per_month);
      const supply = finitePositive(signal.active_supply);
      if (velocity == null) return null;
      return supply != null ? velocity / supply : velocity;
    })
    .filter((value) => value != null);
  const monthlySaleChance = maxNumber(ratios);
  if (monthlySaleChance == null || monthlySaleChance <= 0) return null;
  return Math.max(1, Math.round(30 / monthlySaleChance));
}

function daysLabel(days) {
  if (days == null) return 'unknown';
  if (days < 7) return '<7d';
  if (days <= 30) return '7-30d';
  if (days <= 90) return '30-90d';
  return '90d+';
}

function buildSources(signals) {
  return signals.map((signal) => ({
    provider: signal.provider,
    marketplace: signal.marketplace,
    url: signal.url,
    observed_at: signal.observed_at,
    label: sourceLabel(signal),
  }));
}

function sourceLabel(signal) {
  const bits = [signal.provider];
  if (finitePositive(signal.velocity_units_per_month) != null) bits.push(`${round(signal.velocity_units_per_month)} sold/mo`);
  if (finitePositive(signal.active_supply) != null) bits.push(`${round(signal.active_supply)} active`);
  if (finitePositive(signal.search_interest) != null) bits.push(`interest ${round(signal.search_interest)}`);
  if (finitePositive(signal.wants_count) != null) bits.push(`${round(signal.wants_count)} wants`);
  return bits.join(' ');
}

function headlineFor({ marketplace, score, grade, netProceeds, daysToSale, canShip }) {
  if (!canShip) return `${labelForMarketplace(marketplace)} is not a fit for bulky shipping`;
  if (grade === 'D' || score == null) return 'Not enough market data for a routing call';
  if (score < 15 || (netProceeds != null && netProceeds < 15)) return `Skip selling on ${labelForMarketplace(marketplace)} - donate or recycle`;
  const net = netProceeds != null ? ` - ~$${Math.round(netProceeds).toLocaleString('en-US')} net` : '';
  const saleWindow = daysToSale != null ? `, sells ${daysLabel(daysToSale)}` : '';
  return `Sell on ${labelForMarketplace(marketplace)}${net}${saleWindow}`;
}

function labelForMarketplace(marketplace) {
  const labels = {
    amazon: 'Amazon',
    ebay: 'eBay',
    discogs: 'Discogs',
    reverb: 'Reverb',
    pricecharting: 'PriceCharting',
    local: 'local marketplace',
    web: 'the web',
  };
  return labels[marketplace] ?? marketplace;
}

function bandForScore(score) {
  return SCORE_BANDS.find((band) => score >= band.min).label;
}

function medianNumber(values) {
  const nums = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  return nums[Math.floor(nums.length / 2)];
}

function maxNumber(values) {
  const nums = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  return nums.length ? Math.max(...nums) : null;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function interpolate(value, inMin, inMax, outMin, outMax) {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(Number(value));
}

function roundCurrency(value) {
  return Math.round(Number(value) * 100) / 100;
}
