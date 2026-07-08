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
- `server.js` — a zero-dependency-beyond-the-SDK Node server that serves the static page and exposes one endpoint, `POST /api/analyze`, which proxies the photo to the Claude API and returns structured JSON (schema-enforced via structured outputs). The API key never reaches the browser.

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

See `.env.example` for all configuration.

## Deploying

It's one Node process with no database — any small host works (Fly.io, Railway, Render, a $5 VPS). Set `ANTHROPIC_API_KEY` in the host's secret store and expose the port. Each photo costs one vision API call.

## Roadmap and rationale

The product direction — what this deliberately is and isn't (no in-app marketplace, no accounts in v1, no notifications), the competitive landscape, and the v1/v2 roadmap — is documented in [MURDER_BOARD.md](MURDER_BOARD.md).
