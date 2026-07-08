import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreDemand } from './scorer.js';

test('scores exact marketplace signals and estimates route economics', () => {
  const scores = scoreDemand(
    { shipping_class: 'small' },
    [
      {
        provider: 'keepa',
        marketplace: 'amazon',
        match_precision: 'exact',
        velocity_units_per_month: 35,
        active_supply: 20,
        median_price: 120,
        trend_slope_90d: 0.2,
        url: 'https://example.test/keepa',
      },
      {
        provider: 'trends',
        marketplace: 'amazon',
        match_precision: 'exact',
        search_interest: 70,
        url: 'https://example.test/trends',
      },
    ],
  );

  assert.equal(scores.length, 1);
  assert.equal(scores[0].marketplace, 'amazon');
  assert.equal(scores[0].grade, 'B');
  assert.equal(scores[0].score >= 70, true);
  assert.equal(scores[0].net_proceeds_est, 96);
  assert.equal(scores[0].sources.length, 2);
});

test('returns D grade without exposing a number for category-only signals', () => {
  const scores = scoreDemand(
    { shipping_class: 'medium' },
    [{
      provider: 'ebay-browse',
      marketplace: 'ebay',
      match_precision: 'category',
      active_supply: 40,
      median_price: 35,
      url: 'https://example.test/ebay',
    }],
  );

  assert.equal(scores.length, 1);
  assert.equal(scores[0].grade, 'D');
  assert.equal(scores[0].score, null);
  assert.equal(scores[0].band, 'not enough market data');
});

test('excludes shipped marketplaces for bulky freight routing', () => {
  const scores = scoreDemand(
    { shipping_class: 'bulky-freight' },
    [{
      provider: 'ebay-browse',
      marketplace: 'ebay',
      match_precision: 'exact',
      velocity_units_per_month: 10,
      active_supply: 8,
      median_price: 200,
      url: 'https://example.test/ebay',
    }],
  );

  assert.equal(scores[0].net_proceeds_est, null);
  assert.match(scores[0].headline, /not a fit/);
});
