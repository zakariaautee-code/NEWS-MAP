---
name: map-news-api
description: Build, run, extend, or debug news-aggregation APIs for Moroccan/MAP news sites (map.ma, mapnews.ma, mapsport.ma) or any Drupal/WordPress news portal. Use whenever the user mentions MAP news, Moroccan news feeds, aggregating mapnews.ma content, or wiring a website to news APIs from these sources — even if they just say "news API" in a Morocco context.
---

# MAP News API

This workspace contains a working, tested Node.js + Express API (`src/`) that unifies the three MAP (Maghreb Arabe Presse) properties into one normalized JSON feed. Read this skill before modifying sources or adding new ones.

## Verified upstream facts (do not re-discover)

These were probed live on 2026-10-25 and are the reason the adapters look the way they do:

| Host | Engine | Data path | Quirks |
|---|---|---|---|
| `mapnews.ma` | Drupal 7 | Per-section RSS: `/en/actualites/{section}/rss` (also `/fr/…`, Arabic slugs; top-level `/ar/rss`) | Each RSS `<description>` embeds the **full article** as escaped Drupal field HTML (`field-name-body`, `field-accroche` = lead, `field-date`, `field-ville`, `field-image`, `field-categorie`). Parse with cheerio, not regex. The main `/en/rss.xml` is a stale 2017 test feed — never use it. `robots.txt` demands Crawl-delay 10. Sections are auto-discoverable from homepage `href="/{lang}/actualites/{slug}"`. Deep archive: `/en/sitemap.xml?page=N` (~20k URLs). |
| `www.map.ma` | WordPress 6 | WP REST API: `/en/wp-json/wp/v2/…` (prefix `/fr/`, `/ar/`, `/es/`) | Root `/wp-json` returns the **French** site; always use the language prefix. `_embed=wp:featuredmedia,wp:term` gives image + categories inline. Pagination via `X-WP-Total` headers. Small corpus (~45 EN posts; institutional news). |
| `mapsport.ma` | WordPress | WP REST API at `/wp-json/wp/v2/…` (no lang prefix, French only) | Rich taxonomy (30+ categories, Football = 8000+ posts). Fresh content daily. |
| `www.hibasport.com` | WordPress | WP REST API at `/wp-json/wp/v2/…` (no lang prefix, AR only) | Hiba family sports portal. ~108k Arabic posts. `details-N.html` permalinks → fetch single articles by `?include=N` (slug lookup fails; slugs are Arabic titles). Open REST, verified working. |

> ⚠️ **`hibapress.com` is Cloudflare-protected** — every server-side request (robots.txt, RSS, WP API, even mobile/app UAs) returns **403**; only a real browser passing the JS challenge loads it. **Never attempt server-side access or any bypass** (no headless harvesting, cookie relays, or TLS tricks). The open Hiba-family property **HibaSport** (`hibasport.com`, also `hibapress.net`) is integrated instead.

## Architecture of this repo

- `src/sources/mapnews.js` — Drupal RSS adapter. `getFeed(lang, section)` → normalized articles; `getSections()` auto-discovers sections from the homepage nav (curated fallback in `CURATED_SECTIONS`); `getArticle(url)` scrapes og-meta + body; `getArchive()` paginates the sitemap; `search()` scans section feeds.
- `src/sources/wp.js` — generic WordPress adapter factory (`createWpSource`). Used for both WP hosts; language prefix is a per-source function.
- `src/sources/index.js` — registry + unified `listNews` (merge → dedupe by URL → sort by `publishedAt` → paginate), `getArticle` (routes by hostname), `search`, `health`.
- `src/lib/http.js` — per-host pacing queue (mapnews.ma ≥10 s between requests — robots.txt), timeout, retries.
- `src/lib/cache.js` — TTL cache with **stale-while-error** (upstream failure serves last good data).
- fast-xml-parser needs `processEntities: { maxTotalExpansions: 500_000 }` for mapnews feeds — their descriptions carry hundreds of entities per item; the default cap of 1000 throws.

## When modifying or extending

1. **Adding a source**: write an adapter exposing `{ source, list, getArticle, getCategories? }`, register it in `src/sources/index.js` (`byId` + `SOURCES`), and add its pacing entry in `config.upstreamMinInterval`. Reuse `createWpSource` for any WordPress site.
2. **Never hammer upstreams**: every upstream call must go through `fetchUpstream()` (pacing) and `cached()` (TTL). Steady-state should be a handful of upstream requests per hour.
3. **Date parsing**: mapnews display dates are "23 October 2026" (en/fr via `parseDisplayDate`); Arabic month names don't parse — fall back to RSS `pubDate` (items have it even though the sample in the feed excerpt may not show it).
4. **Section slugs**: mapnews has EN aliases (`politique`/`politics`, `economie`/`economy`, `monde`/`world`). Feeds exist for the French-ish slugs; alias slugs 404 on `/rss`. Prefer discovered sections and skip 404s gracefully.
5. **Arabic**: Arabic section slugs are percent-encoded Arabic words; rely on homepage discovery (`getSections('ar')`) instead of hardcoding.

## Running / testing

```bash
npm start                 # website at http://localhost:3000, docs at /docs
curl "localhost:3000/api/v1/health"                        # all 3 sources ok
curl "localhost:3000/api/v1/news?source=all&lang=en&limit=5"
curl "localhost:3000/api/v1/news/article?url=<encoded>"    # full body
node --watch src/index.js # dev mode
```

Cold-start note: `source=all` aggregates the mapnews **top-level feed** (`/{lang}/rss` — one request, verified live for en/fr/ar with 10 items each) so it is fast in every language. Per-section feeds are used only for explicit `section=` queries and are warmed in the background at boot (en/fr, ~10 s apart due to crawl-delay). The website covers residual cold start with a 30 s client timeout that falls back to the fast `map-portal` source and auto-upgrades after 45 s.

## Website (public/)

`index.html` + `css/styles.css` + `js/app.js|globe.js|ai.js` — a complete news site consuming every API endpoint. Facts that matter when touching it:

- **Branding rule (user requirement)**: the MAP/agency name appears NOWHERE in the site UI. The single attribution point is the automatic **"Source: <domain> ↗"** block rendered at the very END of every article in the reader (`#readerSource`), plus a neutral footer rights line. Never add source badges, labels, or mentions to cards, hero, ticker, or headers. `SRC_LABEL` was removed deliberately — don't reintroduce it.
- **Generative AI layer**: `POST /api/v1/ai/summarize` `{url, lang}` in `server.js`. With `AI_API_KEY` (+ `AI_BASE_URL`, `AI_MODEL`) set it calls any OpenAI-compatible provider and returns `{engine:"generative", tldr, bullets}`; without a key it returns `{engine:"extractive"}` via `src/lib/summarize.js` (server port of the browser engine). The client (`aiSummarize()` in app.js) tries the endpoint first and falls back to `window.MNAI.summarize` on any failure. Bullets are deduped against the headline both sides.
- `js/globe.js` (Three.js r128, vendored) **must** keep `renderer.setClearColor(0x000000, 0)` — without it the canvas paints opaque black over the light theme. `window.MNGlobe.setTheme(light)` swaps additive→normal blending so particles stay visible on light backgrounds.
- Arabic mode: `dir=rtl` on `<html>`, Cairo font, cat-tabs collapse to "All" (Arabic section slugs are discovered, not hardcoded). The API's top-level `/ar/rss` fast path is what makes AR `source=all` fast.
- `js/ai.js` is intentionally network-free (lexicon mood, keyword trending, extractive TextRank-lite summaries) — the trend/mood panels stay on-device; only the article summary has a generative path.
- Reader extras: reading-progress bar (scroll handler stored as `reader._progressHandler`, removed on close), reading time, copy-link button, related strip (`/news` same section/source, excludes current). Card 3D tilt breaks Playwright strict clicks — dispatch clicks programmatically when testing.
- Boot safety: `DOMContentLoaded` handler is wrapped in try/catch, the preloader force-dismisses at 900 ms and 3.5 s, and any `window.error` removes it — a JS failure must never trap the UI behind the preloader. `loadHealth()` failure shows the `#offlineBanner`. "Load more" stays disabled unless a full page (12 items) returned — the `finally` block must not re-enable it.
- **Click-to-load contract (user hit this)**: `loadFeed()` must NEVER early-return on `state.loading`. It keeps an `AbortController` in `state.feedAbort`; every new section/tab/source click aborts the in-flight request and starts fresh (`api()` honors `opts.signal` via `AbortSignal.any`). Stale responses are discarded (`signal !== state.feedAbort.signal → return`). The old "ignore clicks while loading" behavior swallowed every section click for up to 30 s on a cold server — "I click and nothing happens".
- All event bindings go through `bind(sel, evt, fn)` / `bindAll(...)` — a missing element logs a warning instead of throwing, so one stale/broken element can never paralyze every handler. Assets are served with `Cache-Control: no-cache` and versioned query strings (`app.js?v=7`) to prevent stale HTML/JS mixes after upgrades — bump `?v=` on every JS/CSS change.
- Search dropdown debounces 350 ms; `/search` on a cold server can queue behind the warm-up's crawl-delay pacing (up to ~30 s) — expected, instant once warm. Section warm-up is deferred 45 s after boot so early user requests skip the pacing queue.

## Apify Actor deployment (live since 2026-10-25)

Deployed as Apify Actor `preservable_succotash/map-news-api` (id `FUNkgrVzvtcZzglDA`). Facts that matter when touching it:

- **Mandatory proxy**: the MAP sites 403-block datacenter/cloud IPs (verified: Apify AWS egress AND Apify datacenter proxy both 403). `src/lib/http.js` routes every upstream call through Apify Proxy `RESIDENTIAL,country-MA` with one sticky session per run. Driven by `config.proxy` (env: `PROXY_GROUPS`, `PROXY_COUNTRY`); activates only when `APIFY_PROXY_PASSWORD` exists (platform runs) — locally it's a no-op. Uses `undici` `ProxyAgent` + undici's own `fetch` (node's global fetch ignores npm-undici dispatchers). Free plan includes residential within the $5 monthly credit (~$8/GB).
- **Standby contract**: listen on `ACTOR_WEB_SERVER_PORT` (0.0.0.0), answer header `x-apify-container-server-readiness-probe` with 200 (outer middleware wrapping `createApp()`), detect mode via `APIFY_META_ORIGIN === 'STANDBY'`. Regular runs detected via `APIFY_TOKEN` + `ACTOR_RUN_ID`: read input from `APIFY_INPUT_DIR`/run KVS API, push to dataset via `POST /v2/datasets/{ACTOR_DEFAULT_DATASET_ID}/items` (no Apify SDK dependency anywhere).
- **Public URL**: `https://preservable-succotash--map-news-api.apify.actor` — username is normalized (`_` → `-`), joined with `--`; Bearer-token auth. Hitting it auto-starts a standby run (~5–60 s first hit).
- **Deploy**: `apify push` (version must be MAJOR.MINOR). Old standby runs persist up to `idleTimeoutSecs` (600) on the previous build — abort them (`POST /v2/actor-runs/{id}/abort`) to cut over instantly. Standby scaling set via `PUT /v2/acts/{id}` `actorStandby` (currently desired 10 / max 20 concurrent per run, 512 MB).
- **Manifest quirks** (apify-cli 1.10): input schema must live at `.actor/input_schema.json` and every property needs `editor` + `description`; `validate-schema` treats any explicit path as an input schema; CLI has `info` (no `whoami`); browser login (`apify login -m console`) works without a pasted token.
- **Output/dataset schema** (added 2026-10-25, build 1.2.2): `.actor/dataset_schema.json`, referenced from actor.json `"storages": { "dataset": "./dataset_schema.json" }`. Views: `overview` (latest-news table) + `details` (full metadata). **Platform quirk**: the dataset-schema compiler does NOT have the JSON Schema 2020-12 meta-schema registered — do NOT add `"$schema": "…2020-12…"` to `fields` or the build fails with `no schema with key or ref`. `type` union arrays (`["string","null"]`) compile fine. Nullable types matter: city/section/lead/etc. are often null; avoid `required` so pushes can never fail validation.
- **Full schema set** (build 1.3.2, all Console schema checks green): `.actor/output_schema.json` — NOTE it is NOT a JSON Schema of the OUTPUT record; it is `actorOutputSchemaVersion: 1` + `properties` whose values are `{{template}}` link templates (e.g. `{{links.apiDefaultDatasetUrl}}/items`) rendered by the platform into `run.output` (verify via `GET /v2/actor-runs/{id}` → `data.output`; there is no `/output` sub-endpoint). `.actor/key_value_store_schema.json` — `actorKeyValueStoreSchemaVersion: 1` + `collections` (exactly one of `key`/`keyPrefix` each); task mode writes a `summary-<runId>` record via `PUT /v2/key-value-stores/{id}/records/...` (Bearer header). `.actor/openapi.json` — `webServerSchema` in actor.json; **OpenAPI 3.0 does not allow `type` arrays** — use `"type": "string", "nullable": true` (the 3.1 `["string","null"]` form fails platform build validation with a confusing `oneOf` error). Console renders it as the interactive Endpoints tab on the standby URL.
