# What's My Stuff

Snap a photo of your clutter and get an honest answer to the question that actually matters: **what should I do with this thing?**

Point your phone's browser at the app, take a photo, and get a decision card back:

- **What it is** — identification, category, condition as seen in the photo
- **What it's worth** — a realistic used-resale value range
- **What to do with it** — sell, donate, recycle, repurpose, or trash, with the reasoning spelled out (including the honest economics: after ~13% marketplace fees, shipping, and your time, most sub-$30 items are better donated)
- **The one-tap next step** — a ready-to-paste marketplace listing and eBay sold-comps link if selling; a fair-market value for tax records and a donation-center link if donating; recycling guidance; or realistic reuse ideas

No app install, no account. Photos are analyzed by a single Claude API call and discarded — history lives only in your browser's local storage.

## How it works

- `public/` — one mobile-first page. `<input type="file" capture="environment">` opens the camera on phones; photos are resized to ≤1280px JPEG on-device (which also strips EXIF/GPS metadata) before upload.
- `server.js` — a small Node server that serves the static page and exposes one endpoint, `POST /api/analyze`. Model API keys never reach the browser.
- `lib/analyze.js` — pluggable analyzer backends (see below).
- `lib/pricing.js` — optional market-data providers that ground the value estimate in real reseller data.
- `bots/telegram.js` — optional chat interface: text the bot a photo, get the decision card back.

## Running it

Requires Node 18+.

```sh
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # get one at https://platform.claude.com
npm start                              # http://localhost:3000
```

For UI development without an API key:

```sh
npm run dev   # MOCK_ANALYZE=1 — /api/analyze returns a canned result
```

See `.env.example` for every knob described below.

## Choosing an analyzer backend

The model that looks at your photos is pluggable via `ANALYZER`:

| `ANALYZER` | What it uses | Config |
|---|---|---|
| `anthropic` (default) | Claude API — best identification and valuation quality | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` |
| `openai-compatible` | Any `/v1/chat/completions` endpoint: **Ollama, LM Studio, vLLM, OpenRouter** — run fully local with a vision-capable model (e.g. a Hermes or Llama vision build) | `OPENAI_BASE_URL`, `OPENAI_MODEL`, optional `OPENAI_API_KEY` |

Fully-local example with Ollama:

```sh
ollama pull llama3.2-vision
ANALYZER=openai-compatible OPENAI_BASE_URL=http://localhost:11434/v1 \
  OPENAI_MODEL=llama3.2-vision npm start
```

Nothing leaves your machine in that configuration (unless you also enable a pricing provider).

## Market data for resellers

Set `PRICING` to ground the AI's value estimate in the data resellers actually use. Stats are attached to the decision card as `result.market` and shown in the UI and Telegram replies. Lookups fail soft — if the provider is down or the item doesn't match, the card ships without stats.

| `PRICING` | Source | Config |
|---|---|---|
| `none` (default) | — | — |
| `ebay` | eBay Browse API — live comparable listings, asking-price low/median/high (free developer keys at developer.ebay.com) | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` |
| `keepa` | Keepa — the Amazon price-history service resellers use | `KEEPA_API_KEY` |

Note: eBay's *sold*-comps API (Marketplace Insights) is gated behind a partner program, so the eBay provider reports live asking prices and links you to the sold-listings search. Keepa reports current Amazon used/new prices.

## Telegram interface

Walk around the house, snap photos into a chat, triage later:

```sh
# create a bot with @BotFather, then:
TELEGRAM_BOT_TOKEN=123456:ABC... npm run telegram
```

The bot uses long polling, so it runs from a laptop or Raspberry Pi behind NAT with no public URL, and shares the same `ANALYZER`/`PRICING` configuration as the web server. A Slack interface would need a public endpoint or Socket Mode, so Telegram ships first; the analysis logic in `lib/` is interface-agnostic if you want to add one.

## Deploying

It's one Node process with no database — any small host works (Fly.io, Railway, Render, a $5 VPS). Set `ANTHROPIC_API_KEY` in the host's secret store and expose the port. Each photo costs one vision API call.

## Roadmap and rationale

The product direction — what this deliberately is and isn't (no in-app marketplace, no accounts in v1, no notifications), the competitive landscape, and the v1/v2 roadmap — is documented in [MURDER_BOARD.md](MURDER_BOARD.md).
