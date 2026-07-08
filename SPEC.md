# What's My Stuff — Product Spec: "Who Wants This?"

**Status:** Approved spec, pre-implementation. Supersedes the value-estimate-only flow described in [MURDER_BOARD.md](MURDER_BOARD.md) §5 (which remains the record of what this product deliberately is not).

---

## 1. The question

The shipped v0 answers *"what's it worth?"* — a number with no consequence. This spec upgrades the product to answer *"**who wants this?**"* — and its actionable form:

> **"This will sell in ~N days on marketplace X for $Y net of fees. Post it there."**
> or, just as honestly:
> **"Nobody is buying these. Donate it — here's the $12 tax deduction."**

Every design decision below serves that sentence. The output of the system is a **routing decision with a confidence grade**, not a price fantasy.

## 2. Decisions of record

Locked in during planning (2026-07-08):

| Decision | Choice |
|---|---|
| Data acquisition posture | **Legal APIs + first-party flywheel only.** No first-party scraping. No licensed scraped-data brokers (the provider interface permits adding one later without redesign). eBay Marketplace Insights partnership application runs in the background; nothing blocks on it. |
| v1 scope | **Single-item WANTS card** — extend the existing photo → decision-card flow. Room sweep is Phase 2. |
| Flywheel (accounts + outcome tracking) | **Schema designed now, feature ships Phase 3.** v1 stays account-free and stateless server-side. |

## 3. Architecture overview

```
photo ──▶ IDENTIFY ──▶ DEMAND FAN-OUT ──▶ SCORE ──▶ ROUTE ──▶ decision card
           (vision      (provider           (WANTS    (fees,      (web / telegram)
            LLM +        registry:           index     shipping,
            OCR loop)    keepa, ebay,        per       days-to-
                         discogs, reverb,    market-   sale)
                         pricecharting,      place)
                         trends)
                                │
                                └──▶ [P3] OUTCOMES feed the first-party demand index
```

Three provider registries, all selected by environment config, all optional, all failing soft:

- `lib/analyze.js` — **analyzer** backends (exists: Claude API / any OpenAI-compatible local model)
- `lib/demand/` — **demand signal** providers (new; replaces and absorbs `lib/pricing.js`)
- `bots/` — **interfaces** (exists: web, Telegram)

## 4. Stage 1 — Identification (upgrade of existing pipeline)

The demand fan-out is only as good as the identifiers it queries with. v1 adds an **identification loop** to the existing single vision call:

1. **First pass** (existing): name, brand, category, condition, shipping class, generic `search_query`.
2. **Identifier extraction** (new): the vision call also attempts exact identifiers — model number via OCR, UPC/EAN if a barcode is visible, plus category-specific IDs (see §6 catalog mapping). Schema field `identifiers` (below).
3. **Re-prompt loop** (new): when the item's category is model-numbered (electronics, appliances, tools, instruments) and no exact identifier was found, the card returns `follow_up: "Photograph the label/serial plate for an exact match"`. The UI offers a second photo; the server merges both images into one identification call. One retry maximum — the pipeline must degrade gracefully to category-level matching, never nag.

**Match precision** is recorded and propagates all the way to the confidence grade:

| `match_precision` | Meaning |
|---|---|
| `exact` | Model number / UPC / ASIN / catalog ID resolved |
| `similar` | Same brand + product line, variant uncertain |
| `category` | "a stand mixer", nothing more specific |

## 5. Stage 2 — Demand signal providers

Each provider implements one interface and returns zero or more normalized signals:

```js
// lib/demand/<provider>.js
export const id = 'keepa';
export function enabled(env) { /* keys present? */ }
export async function fetchSignals(item) -> DemandSignal[]
```

```jsonc
// DemandSignal — the normalization contract every provider maps into
{
  "provider": "keepa",
  "marketplace": "amazon",          // amazon | ebay | discogs | reverb | pricecharting | local | web
  "match_precision": "exact",       // exact | similar | category
  "observed_at": "2026-07-08T…",
  "velocity_units_per_month": 34,    // real or estimated units sold / month
  "active_supply": 210,              // live competing listings
  "median_price": 142.0,             // USD
  "price_low": 95.0,
  "price_high": 210.0,
  "search_interest": 61,             // 0–100, Trends-style
  "trend_slope_90d": 0.12,           // -1..1 normalized momentum
  "wants_count": 4830,               // explicit demand (Discogs wants, PriceCharting wishlists)
  "haves_count": 12100,              // explicit supply
  "url": "https://…"                 // human-verifiable source link
}
```

All fields except `provider`, `marketplace`, `match_precision`, `observed_at` are optional — the scorer works with whatever arrives.

### v1 provider roster (all legal, documented, key-gated)

| Provider | Marketplace | Signals it can fill | Access |
|---|---|---|---|
| `keepa` | Amazon | velocity (Monthly Sold + sales-rank drops), supply (offer count), prices, 90-day momentum | API key, token-metered |
| `ebay-browse` | eBay | active supply + asking-price distribution (the supply half of sell-through) | Free developer keys |
| `trends` | web | search interest + momentum for the item's query | Unofficial/free |
| `discogs` | Discogs | **wants/haves ratio** (explicit demand), sales history low/median/high | Free API |
| `pricecharting` | PriceCharting | sales volume, wishlist counts, prices (games, consoles, cards, comics) | Paid API (cheap) |
| `reverb` | Reverb | price guide + demand-scored comps (music gear) | Free API |

**Explicitly out (per decision of record):** first-party scraping of eBay/Poshmark/Mercari sold pages; licensed scraped-data brokers; Facebook Marketplace (no API exists). **Background track:** apply for eBay Marketplace Insights (real 90-day sold data); if ever granted, it slots in as provider `ebay-insights` with zero redesign.

### Data-handling constraints

- **Compute on demand; do not warehouse third-party data.** eBay Browse data retention is ToS-limited: cache signals with TTL ≤ 24h, keyed by identifier, then drop.
- Every signal carries its source `url` — the card must let a skeptical user click through and see the evidence.

## 6. Stage 3 — The WANTS Index

**Definition:** `WANTS(item, marketplace)` ∈ 0–100, computed per marketplace (never a single global number — demand is always *somewhere*), from four sub-scores:

| Sub-score | Weight | Source fields | Normalization |
|---|---|---|---|
| **V** — Velocity | 0.40 | `velocity_units_per_month` | log scale: 0/mo→0.0, 1/mo→0.35, 10/mo→0.65, ≥100/mo→1.0 |
| **L** — Liquidity | 0.30 | velocity ÷ `active_supply` (sell-through proxy); `wants_count`/`haves_count` where explicit | STR ≥1.0→1.0, 0.5→0.75, 0.2→0.5, ≤0.05→0.1 |
| **B** — Breadth | 0.20 | `search_interest`; count of marketplaces with any signal | interest/100, blended 50/50 with marketplace-presence ratio |
| **M** — Momentum | 0.10 | `trend_slope_90d` | (slope+1)/2 |

Missing sub-scores **renormalize the remaining weights** (they never count as zero demand). Score bands for UX language: 70–100 *"in demand — sell it"*, 40–69 *"sells, be patient"*, 15–39 *"thin market"*, 0–14 *"nobody's buying — donate/recycle"*.

### Confidence grade (anti-fake-precision mechanism)

| Grade | Criteria | Card behavior |
|---|---|---|
| **A** | `exact` match + ≥2 independent providers with sales/velocity data | Full card, firm language |
| **B** | `exact` match + 1 provider | Full card, hedged language |
| **C** | `similar` match | Ranges widen; card says "based on similar items" |
| **D** | `category` only, or zero demand signals | **No WANTS number shown.** Card falls back to v0 behavior (AI estimate + honest "not enough market data") — D-grade is a first-class answer, not an error state |

## 7. Stage 4 — Routing engine

For each marketplace with a computed score:

```
net_proceeds  = median_price × (1 − fee_rate) − shipping_cost_estimate
days_to_sale  ≈ f(velocity, active_supply)   // p50, bucketed: <7d / 7–30d / 30–90d / 90d+
```

- **Fee table** (versioned constant, reviewed quarterly): eBay ~13.6%, Mercari ~12.9%, Poshmark 20%, Reverb ~8.2%, Discogs 9%, Amazon category rates, local (FB Marketplace/Craigslist) 0%.
- **Shipping class** from the photo (`small / medium / large / bulky-freight`) gates routing: `bulky-freight` excludes shipped marketplaces entirely → local-only or donate.
- **Output:** ranked list. Rank 1 becomes the card's headline sentence. The v0 sub-$30 economics rule is now *computed* (net proceeds vs. a time-cost floor) instead of prompted.

## 8. The decision card (v1 UX delta)

Additions to the existing card:

1. **WANTS meter** — score + band label + confidence grade, colored like the disposition badge.
2. **Routing table** — up to 3 rows: marketplace, est. net, est. days-to-sale, source link. Rank 1 highlighted.
3. **Headline rewrite** — disposition badge text becomes the routing sentence ("Sell on eBay — ~$124 net, sells in under 2 weeks").
4. **Evidence footer** — "Signals: Keepa (34 sold/mo) · eBay (210 active) · Trends (61)". Every claim clickable.
5. **Follow-up prompt** — the "photograph the label" retry when it would upgrade the grade.

Telegram bot renders the same fields in text. The API response envelope adds `result.wants: WantsScore[]` and `result.follow_up?: string`.

## 9. Flywheel schema (designed now, shipped P3)

The moat: every scan is a supply observation; every reported outcome is a **true demand observation** no marketplace will sell us. Schema is fixed now so P1/P2 data (kept client-side in localStorage) migrates cleanly when accounts arrive:

```jsonc
// Item (extends current history entry)
{ "id": "uuid", "ts": 0, "name": "", "brand": "", "category": "",
  "identifiers": { "model": "", "upc": "", "asin": "", "epid": "", "discogs_release_id": "", "pricecharting_id": "" },
  "condition": "", "shipping_class": "", "wants": [ /* WantsScore[] */ ] }

// WantsScore
{ "marketplace": "ebay", "score": 72, "grade": "B",
  "days_to_sale_p50": 11, "net_proceeds_est": 124.0,
  "components": { "V": 0.65, "L": 0.8, "B": 0.61, "M": 0.55 },
  "sources": [ /* provider + url refs */ ] }

// Outcome (P3 — the flywheel event)
{ "item_id": "uuid", "action": "sold",        // listed | sold | delisted | donated | trashed
  "marketplace": "ebay", "listed_price": 140.0, "sold_price": 124.5,
  "listed_at": "…", "sold_at": "…" }
```

P3 adds: optional accounts (magic-link — never passwords, per murder board), `POST /api/outcomes`, a "did it sell?" nudge, and optional eBay OAuth (Sell API) which makes outcome capture automatic *and* enables one-tap listing creation (P4). Aggregated outcomes become the `firstparty` demand provider — same `DemandSignal` interface as every other source.

## 10. Room sweep (P2)

One photo of a shelf/garage → triaged item grid. Two-stage to control cost:

1. **Triage pass** — one cheap vision call (low effort tier) over the full frame: bounding boxes + name + coarse value bucket (`junk / maybe / worth-pricing`).
2. **Deep pass** — full §4–§7 pipeline **only** for `worth-pricing` items (est. >$20), run concurrently, budget-capped (default: max 10 deep analyses per sweep, configurable).

UI: tappable thumbnail grid → each opens a standard decision card. Batch summary line: "23 items: 4 worth selling (~$310 net), 12 donate, 7 recycle/toss."

## 11. Phasing & acceptance criteria

| Phase | Ships | Done when |
|---|---|---|
| **P1 — WANTS card** | `lib/demand/` registry (6 providers), identifier extraction + one-retry loop, WANTS scorer + grades, routing engine, card UX delta, Telegram parity | A photo of a name-brand item with ≥1 configured provider yields a graded, per-marketplace routing card whose every number links to a source; an unidentifiable item degrades to grade D / v0 behavior without error |
| **P2 — Room sweep** | Triage pass, batch grid UI, concurrency + budget caps | A 20-object garage photo costs ≤ ~5× a single-item scan and produces a correct junk/maybe/sell triage |
| **P3 — Flywheel** | Accounts (magic link), `POST /api/outcomes`, sold-nudge, `firstparty` provider | An outcome recorded on one item measurably feeds the index for the next matching scan |
| **P4 — Auto-list** | eBay OAuth + Sell API listing creation with generated title/desc/price/photos | One tap from decision card to live eBay listing |

## 12. Costs (per single-item scan, order of magnitude)

Vision call ~$0.03–0.10 (Claude API; $0 self-hosted local model) + Keepa ~fractions of a cent (token-metered) + free APIs (eBay Browse, Discogs, Reverb, Trends within quotas) → **≈ $0.05–0.12 per item**, dominated by the vision call. Room sweep with triage: ≈ $0.15–0.60 per room. No per-user infrastructure until P3.

## 13. Non-goals (standing, from the murder board)

- No in-app marketplace, payments, chat, or trades — we route demand *to* existing marketplaces.
- No first-party scraping; no warehousing of third-party marketplace data.
- No global demand number without a marketplace attached.
- No fake precision: a D-grade honest shrug beats a confident hallucination.
- No accounts before P3; no passwords ever.

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Composite proxies mislead (Amazon velocity ≠ local demand) | Per-marketplace scores only; shipping-class gating; confidence grades; source links on every claim |
| Coverage hole for long-tail household items | Grade D as designed first-class fallback; verticals (Discogs/Reverb/PriceCharting) cover the high-value collectible tail where "who wants this" matters most |
| Keepa/eBay pricing or ToS changes | Provider registry isolates each source; any provider can die without taking the product down |
| Competitors (Underpriced, Cluzy) add a demand score | Their data is scraped and horizontal; our defenses: zero-install web + self-host/local-model story + vertical aggregation + P3 first-party outcomes they can't copy |
| Flywheel cold start | The product is fully useful at P1 without it; outcomes accrue as a byproduct of listing drafts, not as a chore |

## 15. Configuration (delta to `.env.example`)

```sh
# Demand providers — enable any subset; absent keys = provider skipped
KEEPA_API_KEY=
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
DISCOGS_TOKEN=
PRICECHARTING_API_KEY=
REVERB_TOKEN=
TRENDS_ENABLED=1

# Scoring
WANTS_CACHE_TTL_HOURS=24        # third-party data never stored longer
SWEEP_MAX_DEEP_ITEMS=10         # P2 budget cap
```
