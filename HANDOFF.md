# Developer Handoff — What's My Stuff

Everything you need to pick this project up and build Phase 1 of the approved spec. Read this file first; it tells you what exists, what's decided, what to build next, and the traps we already stepped in so you don't have to.

---

## 1. Orientation — read in this order

| Doc | What it is |
|---|---|
| [README.md](README.md) | What's built and how to run it |
| [MURDER_BOARD.md](MURDER_BOARD.md) | Why the product is shaped this way: competitive landscape, the kill list (things we deliberately do NOT build), code-review history of the original scaffold |
| [SPEC.md](SPEC.md) | **Your work order.** The approved "WANTS Index" spec: demand scoring, routing, phasing, schemas. Decisions in §2 there are locked — don't relitigate them in code. |
| This file | Task breakdown, conventions, environment, gotchas |

**One-paragraph summary:** Users photograph household items; the app answers *"who wants this?"* — a per-marketplace demand score (WANTS Index, 0–100, confidence-graded A–D) that resolves into a routing decision: *"Sell on eBay, ~$124 net, sells in under 2 weeks"* or, just as honestly, *"nobody's buying these — donate it, here's the $12 tax deduction."* No in-app marketplace, no accounts (until P3), no scraping, ever.

## 2. Current state (all verified working)

Branch: `claude/repo-murder-board-7hpnji` (master still holds the dead PHP scaffold — everything real is on this branch).

```
server.js            Node stdlib HTTP server: static files + POST /api/analyze
lib/analyze.js       Analyzer registry: ANALYZER=anthropic (Claude API, default)
                     or openai-compatible (Ollama/LM Studio/vLLM — local models)
lib/pricing.js       Market-stats providers: PRICING=ebay|keepa|none (fail-soft)
                     → YOU WILL REPLACE THIS with lib/demand/ (task T1)
public/              One mobile-first page: camera capture, on-device resize
                     (strips EXIF/GPS), decision card, localStorage history
bots/telegram.js     Long-polling Telegram bot (self-hostable, no public URL),
                     shares lib/ with the web server
test/smoke.mjs       npm test — boots mock server, checks API surface, drives
                     the real UI headlessly (needs a Chromium; see §4)
.env.example         Every config knob, documented
```

What has NOT been exercised: a **live Claude API call** (the dev container had no key — mock mode covered the wiring) and the **eBay/Keepa providers** (implemented against documented APIs, never run with real keys). Your first task is a real-key smoke test of all three (§5, T0).

## 3. Ground rules (non-negotiable, from SPEC §2/§13)

1. **No scraping. No warehousing third-party data.** Demand signals are computed on demand and cached in memory ≤ 24h (`WANTS_CACHE_TTL_HOURS`), keyed by identifier. If a provider's ToS conflicts with a feature, the feature loses.
2. **Fail soft everywhere.** A dead demand provider returns `null`/`[]` and logs; the card ships without that signal. Third-party APIs must never 500 the user's request.
3. **Honesty over precision.** Grade D (no market data) shows NO demand number — it falls back to the v0 card. That's a first-class answer, not an error state. Never present a category-level guess as an exact-match fact.
4. **Per-marketplace only.** There is no global demand number. Every score, price, and days-to-sale is attached to a marketplace.
5. **Secrets stay server-side.** No API key ever reaches the browser. New providers get keys via env vars, documented in `.env.example`.
6. **No accounts, no server-side user data until P3** — and then magic-link only, never passwords.
7. **Keep the dependency budget.** Runtime deps: `@anthropic-ai/sdk` only. Prefer Node stdlib + `fetch`. Adding a framework needs a strong reason.

## 4. Environment setup

```sh
git clone git@github.com:shanetrimbur/whats-my-stuff.git
cd whats-my-stuff && git checkout claude/repo-murder-board-7hpnji
npm install                 # Node 18+ (uses global fetch, AbortSignal.timeout)
npm run dev                 # mock mode, no keys needed → http://localhost:3000
npm test                    # 12-check smoke suite (API + headless browser)
```

- `npm test`'s browser section needs a Chromium binary: set `CHROME_PATH=/path/to/chrome` or install one; without it the browser checks skip (API checks still gate). CI should run the full suite.
- Real analysis: `export ANTHROPIC_API_KEY=...` then `npm start`. Local-model path: see README §analyzer (Ollama example).
- Telegram: `TELEGRAM_BOT_TOKEN=... npm run telegram`.

## 5. Phase 1 work plan — ordered tasks

Work top to bottom; each task is independently commitable and keeps `npm test` green. Acceptance criteria for the phase as a whole: SPEC §11 row P1.

### T0 — Real-key smoke test (½ day)
Run one real photo through: (a) `ANALYZER=anthropic` with a live key, (b) `PRICING=ebay` with free dev keys, (c) `PRICING=keepa` if a key is available. Fix whatever drifts (likeliest spots: the structured-output request shape in `lib/analyze.js:analyzeWithAnthropic`, eBay OAuth scope string, Keepa response fields in `lib/pricing.js:keepaStats`). Commit fixes before building on top.

### T1 — `lib/demand/` registry (1 day)
Create the registry per SPEC §5: each provider module exports `{ id, enabled(env), fetchSignals(item) -> DemandSignal[] }`. A `lib/demand/index.js` orchestrator runs all enabled providers concurrently (`Promise.allSettled`, per-provider timeout, fail-soft), merges results, and applies the in-memory TTL cache. **Port the existing eBay and Keepa code from `lib/pricing.js` into `demand/ebay-browse.js` and `demand/keepa.js`** (map their outputs into `DemandSignal` — the field mapping is mostly done in those functions already), then delete `lib/pricing.js` and its call sites. The old `result.market` card line can stay temporarily, fed from the richest signal, until T7 replaces it.

### T2 — Identifier extraction + follow-up loop (1 day)
- Extend `ANALYSIS_SCHEMA` in `lib/analyze.js` with `identifiers` (`model`, `upc`, `asin`, `epid`, `discogs_release_id`, `pricecharting_id` — all string, empty when unknown) and `needs_label_photo` (boolean: true when the category is model-numbered and no exact identifier was read).
- `POST /api/analyze` accepts `images: [dataUrl, ...]` (max 2) alongside the existing `image` (keep backward compat). Two images = one vision call with two image blocks.
- Response gains `follow_up` when `needs_label_photo` and only one image was sent. **One retry max** (SPEC §4).

### T3 — Four new demand providers (2–3 days)
Each is a thin fetch + normalization into `DemandSignal`. Register for keys as you go (§6).
- `demand/discogs.js` — `GET /database/search` (token) to resolve a release, then release stats: **community want/have counts** → `wants_count`/`haves_count`, marketplace price suggestions → prices. Only fires for `category` matching music/vinyl.
- `demand/reverb.js` — `GET /api/listings` + price guide endpoints (token). Music gear only.
- `demand/pricecharting.js` — `GET /api/product?t=<key>&q=` → prices, sales volume (games/consoles/cards). Paid key, cheap.
- `demand/trends.js` — Google Trends has no official API; use the widget endpoints (`trends.google.com/trends/api/…`) with graceful degradation, or the `TRENDS_ENABLED` flag simply stays off if it proves too flaky. This provider is **Breadth/Momentum garnish, not load-bearing** — do not sink more than a day into it.

### T4 — WANTS scorer (1 day, pure function + unit tests)
`lib/wants.js`: `computeWants(signals) -> WantsScore[]` implementing SPEC §6 exactly — sub-score normalization curves, weights (V .40 / L .30 / B .20 / M .10), **renormalization when sub-scores are missing**, grade assignment (A/B/C/D from match precision + independent-source count). No I/O — takes `DemandSignal[]`, returns scores. Add `test/wants.test.mjs` with fixture signals covering: full-signal A-grade, single-source B, similar-match C, empty D, missing-subscore renormalization. Wire into `npm test`.

### T5 — Routing engine (1 day)
`lib/route.js`: `route(item, wantsScores) -> Routing[]` per SPEC §7. Fee table as a versioned constant with a source-URL comment per rate. Days-to-sale buckets from velocity/supply. Shipping-class gating (`bulky-freight` → local/donate only). The computed "not worth selling" threshold replaces the prompt-level $30 rule — when rank-1 net proceeds < floor, disposition flips to donate with FMV.

### T6 — Server wiring (½ day)
`handleAnalyze`: identify → `demand.fetchAll(item)` → `computeWants` → `route` → envelope `{ result: { …card, identifiers, wants: WantsScore[], routing: Routing[], follow_up? } }`. Demand fan-out runs concurrently with nothing (it needs identifiers), so total latency ≈ vision call + slowest provider (providers have 6s timeouts).

### T7 — Card UX delta (1–2 days)
Per SPEC §8: WANTS meter (score + band + grade, reuse badge color system), routing table (≤3 rows, rank-1 highlighted, every number links to its source URL), headline rewrite from rank-1 routing, evidence footer, second-photo follow-up flow (a "photograph the label" button that re-opens the camera and re-submits with both images). Grade D renders exactly the current v0 card. Extend `test/smoke.mjs` with an intercepted-response fixture containing `wants`/`routing` (same pattern as the existing sell-branch check).

### T8 — Telegram parity (½ day)
`formatCard` in `bots/telegram.js` gains the routing lines and evidence URLs. Follow-up loop maps naturally: bot replies "send a close-up of the label", next photo from the same chat within N minutes merges.

### T9 — Docs (½ day)
Update README (provider table, new response envelope), `.env.example` (SPEC §15 block), and mark SPEC P1 acceptance criteria as met with a short "how verified" note.

**Total: roughly 8–10 dev days.**

## 6. API key registrations (start these day 1 — some have approval lag)

| Provider | Where | Notes |
|---|---|---|
| Anthropic | platform.claude.com | Default analyzer. Model default `claude-opus-4-8` (overridable via `ANTHROPIC_MODEL`) |
| eBay Developer | developer.ebay.com | Free. Browse API works immediately with client-credentials OAuth. **Also file the Marketplace Insights API application now** (real sold data; partner-gated; weeks–months; do not block on it — it slots in later as `demand/ebay-insights.js`) |
| Keepa | keepa.com/#!api | Paid, token-metered. The `stats=90` param on `/search` is what returns price/velocity stats |
| Discogs | discogs.com/settings/developers | Free personal token |
| PriceCharting | pricecharting.com/api-documentation | Paid, cheap |
| Reverb | reverb.com/my/api_settings | Free token |

## 7. Gotchas we already hit (save yourself the hours)

**Claude API (`lib/analyze.js`)**
- Structured outputs go in `output_config: { format: { type: 'json_schema', schema } }` on `messages.create` — not the deprecated top-level `output_format`. Schemas need `additionalProperties: false` and full `required` on every object; numeric min/max constraints are NOT supported.
- Do **not** add `temperature`/`top_p`/`top_k` — they 400 on current Opus models. Thinking is `{ type: 'adaptive' }`; there is no `budget_tokens`.
- Check `response.stop_reason === 'refusal'` before reading content (surfaced to the user as 422).
- SDK errors: use the typed classes (`Anthropic.AuthenticationError` etc.) — see `errorToStatus()`. Extend that function rather than inventing a parallel mechanism.

**eBay**
- Browse API returns **active listings (asking prices)** — the supply side. Real sold data is gated behind Marketplace Insights. Never label asking-price stats as "sold" in the UI; the `kind` field on signals exists for exactly this.
- OAuth is client-credentials against `/identity/v1/oauth2/token` with scope `https://api.ebay.com/oauth/api_scope`; token is cached in-module with 60s expiry slack.
- ToS limits data retention — hence the ≤24h in-memory cache rule; no persistence layer for signals.

**Keepa** — prices are integer **cents** in arrays indexed by type (0=Amazon, 1=New, 2=Used), `-1` means no data. See `centsOf()` in the current code.

**Frontend**
- Photos are resized to ≤1280px JPEG **on-device** before upload; this doubles as EXIF/GPS stripping. Don't move resize server-side — you'd start receiving 12MP HEIC uploads and users' home GPS coordinates.
- localStorage has a ~5MB quota: history is capped at 25 entries, thumbnails 96px, and there's a drop-thumbnails-and-retry fallback in `saveToHistory`. Keep new per-item data (wants/routing) small.
- `clipboard.writeText` requires a secure context — fine on localhost and HTTPS, silently unavailable on plain-HTTP LAN deploys.

**Server** — the analyzer body cap is 8MB and media types are whitelisted (`jpeg/png/webp`); static serving already guards path traversal. Keep both when touching `server.js`.

**Telegram** — long polling (`getUpdates`, 50s timeout) so it works behind NAT; Telegram re-compresses photos to JPEG, so `image/jpeg` is always the right media type for bot photos.

**Testing** — `npm test` self-boots the server on :3999 in mock mode; the browser section auto-detects Chromium (env `CHROME_PATH` first). The intercepted-`/api/analyze` fixture pattern in `test/smoke.mjs` is how you test UI branches without a model call.

## 8. Workflow

- Develop on `claude/repo-murder-board-7hpnji` (or branch off it) — **not master**.
- `npm test` green before every push; add checks alongside features (the suite is the safety net — there's no CI yet, and setting one up (GitHub Actions: `npm ci && npm test`, headless Chromium available on ubuntu runners via `npx playwright install chromium`) is a welcome first-day task).
- Commit style: imperative summary + a body saying *why*. Small, single-purpose commits — the history so far is the example.
- When P1 is done, open a PR against master with before/after screenshots of the card (grade A and grade D cases).

## 9. Where to ask questions

Decisions already made live in SPEC §2 and MURDER_BOARD §5 — check there before asking. Genuinely open items (product owner's call, flag before building): exact fee-table values and the "not worth selling" time-cost floor (T5); whether Trends ships in P1 if the unofficial endpoints prove flaky (T3); copy/tone of the WANTS band labels (T7).
