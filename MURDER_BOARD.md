# Murder Board: whats-my-stuff

*A no-mercy review of this repo against its stated goal: a web-facing tool that is
actually useful and not duplicative with existing tools (unless the duplication is
cheaper for both builder and user).*

---

## 1. Executive verdict

**The repo is a 118-line scaffold, not an application.** 10 of its 14 source files are
empty placeholders. The one working path (webcam → base64 POST → SQLite insert) throws
away the photo and stores two hardcoded fake tags. Nothing in the README's feature list
(auth, AI tagging, marketplace, real-time notifications) exists.

That is actually good news: **there is almost nothing to salvage, so there is nothing
holding you back from repositioning.** The bad news is strategic, not technical: since
this repo was scaffolded, the market has filled in around the obvious idea. "Photograph
an item, AI tells you what it is and what it's worth" now has multiple shipped
competitors (Underpriced AI, WhatsitAI, Cluzy, ThriftAI), and AI-powered home inventory
is likewise crowded (Dib, Vorby, SaveOr, HomeZada). The in-app marketplace ambition was
never viable — two-sided marketplaces die of cold start, and eBay/Facebook
Marketplace/OfferUp already have the buyers.

**The surviving wedge:** almost all of those competitors are (a) native mobile apps
requiring install + account + subscription, and (b) aimed at *resellers* (thrift
flippers) or *insurance inventories*. Nobody owns the plain-language question your
README actually asks: *"here is a pile of junk — for each thing, should I sell it,
donate it, recycle it, or repurpose it, and what's the one-tap next step?"* A
**zero-install, account-optional web tool that acts as a disposition engine** — and
funnels sell-worthy items *into* eBay/FBM with a prefilled listing rather than
competing with them — is the non-duplicative, cheapest-for-everyone version of this
product. In 2026 the "AI" part is one multimodal LLM call; the product is the decision
UX, not the model.

---

## 2. Claims vs. reality

| README claim | Reality in code |
|---|---|
| "Webcam capture and item tagging" | Capture works; "tagging" is `['mockedTag1', 'mockedTag2']` hardcoded in `save_image.php`. The image itself is **never saved anywhere**. |
| "AI/ML tagging" | `process_image.php` is an empty placeholder. |
| "User authentication" | `login.php` and `register.php` are empty placeholders. `logout.php` destroys a session that nothing ever creates. |
| "Marketplace for listing, trading, and transacting" | `trade.php` and `transaction.php` are empty. `list_items.php` does `SELECT * FROM items` — there are no listing, trade, or transaction tables at all. |
| "Real-time notifications" | Both notification files are empty placeholders. |
| "SQLite database for item storage" | Schema is two tables; `items` has only `id` and `tags`. The checked-in `database/database.db` is not even a valid SQLite file (it's ASCII text). |

---

## 3. Code-level findings

Ordered by severity. None of these are worth patching individually — see §5 — but they
document why a rewrite is cheaper than a rescue.

### Broken today
1. **The photo is discarded.** `backend/save_image.php` reads `$_POST['image']` and
   never writes it to disk or the DB. The core asset of the entire product is thrown
   away on arrival.
2. **Database paths are wrong.** `save_image.php` and `list_items.php` open
   `'../database/database.db'` relative to the executing script's working directory.
   From `backend/marketplace/`, that resolves to `backend/database/database.db`, which
   doesn't exist. The two endpoints, if both worked, would talk to different databases.
3. **Frontend can't reach the backend as deployed.** `app.js` fetches
   `../backend/save_image.php` — a URL-relative path that only resolves if the web
   server's docroot is the repo root, which also means…
4. **…the database sits inside the webroot.** With the repo root as docroot, anyone can
   download `database/database.db` (and with it, per the schema, plaintext passwords).
5. **`logout.php` redirects to `../index.html`**, which doesn't exist (`index.html`
   lives in `frontend/`).
6. **Runtime data is committed to git** (`database/database.db`), and it's corrupt.
   There is no `.gitignore`, no `LICENSE`, and `setup.sh` only works if run from inside
   `scripts/`.

### Broken the moment it goes web-facing
7. **Plaintext passwords by design.** `users.password TEXT` with no hashing anywhere in
   sight. Any future auth code inherits this schema.
8. **Zero authorization.** `items` has no `user_id`; every endpoint is anonymous;
   `list_items.php` returns every row (twice, actually — `fetchArray()` defaults to
   both numeric and associative keys) to anyone who asks.
9. **Unbounded uploads.** Base64 PNG in a form-urlencoded body: ~33% size inflation, no
   size limit, no MIME validation, no rate limiting. A free DoS and disk-filler.
10. **No CSRF, no CORS policy, no input validation, no error handling** anywhere.

### Architecture & schema
11. **The schema cannot express the product.** No `user_id`, image path, title,
    description, condition, estimated value, status, or timestamps on items; no tables
    for any marketplace concept. This isn't v0.1 of the right schema — it's a different
    (absent) product.
12. **PNG over JPEG/WebP** for photos of physical objects: ~5–10× the bytes for zero
    benefit. Desktop-webcam-first (`getUserMedia` with no `facingMode`) for a product
    whose README says "most likely a mobile device."
13. **Hand-rolled vanilla PHP** means hand-building the highest-risk components (auth,
    sessions, uploads, routing, migrations) from scratch — the parts frameworks exist
    to de-risk. Fine choice in 2010; unforced error now.

---

## 4. Duplication analysis (the strategic murder)

Your stated constraint: don't build what already exists, unless the duplication is
cheaper for you *and* the user.

| Feature in this repo's vision | Who already owns it | Verdict |
|---|---|---|
| In-app marketplace (list / trade / transact) | eBay, Facebook Marketplace, OfferUp, Craigslist, Mercari, Vinted | **Kill.** Cold-start problem is fatal; you will never have buyers. Payments + fraud + disputes is a company, not a feature. Duplication here is *more* expensive for everyone. |
| Photo → identification → resale value | Underpriced AI, WhatsitAI, Cluzy, ThriftAI (all shipped, all pull real sold comps from eBay/Poshmark/Mercari) | **Don't compete head-on.** But this is now a commodity — one multimodal LLM call — so *including* it as a step in a larger flow is cheap duplication that saves the user an app install. Acceptable under your rule. |
| Home inventory cataloging | Sortly, Dib, Vorby, SaveOr, HomeZada, Club of Things | **Kill as a goal.** Fine as a free byproduct (your history list *is* an inventory; a CSV/PDF export is a weekend feature), but don't market against them. |
| Donation valuation / tax records | DeductAble, Goodwill value guides | Partial overlap. A "donate" disposition with an IRS-ballpark FMV is one prompt away — cheap duplication, real user value. |
| "What should I *do* with this thing?" — sell vs. donate vs. recycle vs. repurpose, with the next step executed | **Nobody, cleanly.** Resale apps assume you're selling; inventory apps assume you're keeping; donation apps assume you're donating. | **This is the product.** The decision, not the catalog. |
| Real-time notifications | n/a | **Kill.** There is no event in the v1 product worth notifying about. |
| Accounts/auth | Every identity provider | **Defer.** v1 can be account-free (local storage). When needed, use OAuth/magic links — never the plaintext-password schema in this repo. |

**The distribution edge is the web itself.** Every serious competitor found is a native
app behind an install and usually a subscription. "Point your phone's browser at
`whatsmystuff.app`, snap a photo, get an answer" is a fundamentally cheaper promise —
cheaper for the user (no install, no account, no $) and for you (one PWA, no app
stores, no 30% platform tax). That *is* your non-duplication argument.

---

## 5. Recommendations

### Kill list (delete, don't fix)
- `backend/marketplace/trade.php`, `transaction.php` — the marketplace ambition entirely.
- `backend/notifications/` — both files.
- `backend/auth/` — hand-rolled auth; revisit post-v1 with OAuth if accounts earn their keep.
- `database/database.db` — remove from git, add `.gitignore`.
- The current `items`/`users` schema.

### The product to build instead

> **v0 (a weekend):** One mobile-first web page. Take/upload a photo (use
> `<input type="file" accept="image/*" capture="environment">` — works on every phone
> with zero permission jank, fall back to `getUserMedia` on desktop). Client-side
> resize to ~1280px JPEG. One backend endpoint proxies a single multimodal LLM call
> returning structured JSON: `{name, category, condition, est_value_range,
> disposition: sell|donate|recycle|repurpose|trash, reasoning, listing_draft,
> donation_fmv, repurpose_ideas[]}`. Render it as a decision card. History in
> localStorage/IndexedDB. **No accounts, no database, no auth surface.**
> Build in one small modern stack (SvelteKit/Next.js/Astro + one serverless function),
> or keep PHP if you must — but as one endpoint, not fourteen files.

> **v1:** The "one-tap next step" per disposition — this is where you beat the
> reseller apps on usefulness without duplicating them: *sell* → prefilled eBay
> listing (Browse/Sell API or, as v0.5, a deep link to eBay's sold-comps search) and
> copy-paste-ready FBM/Craigslist text; *donate* → nearest donation centers + FMV line
> for tax records; *recycle* → local disposal rules lookup by zip; *repurpose* → the
> crowdsource-ideas angle from your original README, seeded by the LLM.
> Add optional accounts + server-side history only now.

> **v2 (only if v1 gets usage):** "Declutter session" bulk mode (photograph a shelf,
> triage 20 items in one pass — Vorby-style room scanning is the ceiling here);
> insurer-ready CSV/PDF export as the free inventory byproduct; per-item value
> tracking.

### The economics sanity check to encode in the product
Competitors bury this; you should lead with it: **for items under ~$30, selling is
usually a net loss** after ~13% marketplace fees, shipping materials, and your time.
A tool whose honest answer is frequently "donate it, here's the tax value, here's the
nearest drop-off" is more useful — and more differentiated — than one that always says
"list it."

### Hygiene (regardless of direction)
- `.gitignore` (runtime DB, `.env`, uploads), `LICENSE`, and a README that describes
  what exists rather than what's imagined.
- Secrets (LLM API key) server-side only — never call the model from the browser.
- Enforce upload limits and MIME validation at the endpoint; strip EXIF/GPS from
  stored photos (they reveal users' home locations).
- If any user data is ever stored server-side: hashed credentials only (or no
  credentials at all — OAuth), DB outside the webroot, parameterized queries (the one
  thing `save_image.php` already got right).

---

## 6. Sources

Competitive landscape referenced above:

- [What Is My Stuff Worth? 7 Apps That Tell You (2026) — Underpriced AI](https://underpricedai.com/blog/what-is-my-stuff-worth-apps)
- [AI Pricing Tools for Resellers 2026 — Underpriced AI](https://underpricedai.com/blog/ai-pricing-tools-for-resellers)
- [WhatsitAI: ID & Value Anything — Google Play](https://play.google.com/store/apps/details?id=com.dreambit.whatsit.app&hl=en_US)
- [AI Scan Apps for Thrifting (2026) — Cluzy](https://cluzy.app/blog/ai-scan-thrift-scanner-apps)
- [ThriftAI: Profit Identifier — Google Play](https://play.google.com/store/apps/details?id=com.fulcra.thriftai&hl=en_US)
- [8 Apps to Take a Picture to See How Much Something is Worth — Vendoo](https://blog.vendoo.co/apps-to-take-a-picture-to-see-how-much-something-is-worth)
- [Clothing Donation Value Guide 2025–2026 — DeductAble](https://deductable.ai/blog/clothing-donation-value-guide/)
- [Best Home Inventory Apps in 2026 — SaveOr](https://www.saveor.com/blog/best-home-inventory-apps-2026)
- [Best Sortly Alternatives (2026) — Smart Home Admin](https://www.smarthomeadmin.com/alternatives/sortly-alternatives)
- [Best AI Home Inventory Apps (2026) — Smart Home Admin](https://www.smarthomeadmin.com/blog/ai-home-inventory-apps/)
- [Vorby vs Sortly — Vorby](https://vorby.com/vorby-vs-sortly-home-inventory-apps)
- [Best Home Inventory Apps 2026 — Club of Things](https://clubofthings.app/blog/best-home-inventory-apps)
