# MAP News API + Maroc News website

Two products in one repo:

1. **Maroc News** (`/`) — a full news website for Morocco: 3D particle globe hero, live ticker, AI insights (trending / mood / briefing, all on-device), category feeds, sport rail, culture strip, article reader, search, four languages (EN/FR/AR with full RTL, ES), dark & light themes.
2. **MAP News API** (`/api/v1/…`, docs at `/docs`) — the unified REST API powering the site, aggregating all MAP properties.

It merges three upstream MAP properties into one consistent, normalized feed:

| Source | Website | Kind | Languages |
|---|---|---|---|
| `mapnews` | [mapnews.ma](https://mapnews.ma/en) | Daily news portal (Drupal, rich per-section feeds) | EN · FR · AR |
| `map-portal` | [www.map.ma](https://www.map.ma/en/) | Official institutional site (WordPress REST API) | EN · FR · AR · ES |
| `map-sport` | [mapsport.ma](https://mapsport.ma) | Sports portal (WordPress REST API) | FR |
| `hibasport` | [hibasport.com](https://hibasport.com) | Sports portal — Hiba family (WordPress REST) | AR |

No HTML scraping of fragile layouts where a real feed exists: mapnews is served by its own per-section RSS feeds (which embed the **full article body**, lead, city, category and image), and the two WordPress sites by their native JSON REST APIs. An auto-discovered section index and a 19 000+ URL sitemap archive round out deep browsing.

The HibaPress general portal (hibapress.com) is behind Cloudflare bot protection and is intentionally not accessed; HibaSport, the family's open property, is integrated instead.

---

## Quickstart

```bash
npm install
npm start
# → http://localhost:3000  (interactive docs)
# → http://localhost:3000/api/v1/news?source=all&lang=en&limit=10
```

Docker:

```bash
docker build -t map-news-api . && docker run -p 3000:3000 map-news-api
```

### Publish on Apify — ✅ live

The repo ships as an Apify Actor (`.actor/actor.json`, `.actor/input_schema.json`, Apify Dockerfile) with two run modes:

- **Standby mode (live)** — the Actor serves the whole thing as a **public HTTP API**: every `/api/v1/…` endpoint plus the website, at `https://preservable-succotash--map-news-api.apify.actor`. Authenticate with your Apify token: `Authorization: Bearer <APIFY_TOKEN>`.
- **Regular runs** — "Start" / run-sync reads the input schema (`source`, `lang`, `section`, `limit`, `page`, `query`, `articleUrl`) and produces a **dataset of articles** (full bodies included).

```bash
# latest EN news through the Actor
curl -H "Authorization: Bearer $APIFY_TOKEN" \
  "https://preservable-succotash--map-news-api.apify.actor/api/v1/news?source=all&lang=en&limit=10"
```

To update and redeploy:

```bash
apify push       # build a new version and tag it "latest"
# standby runs on the old build live up to 10 min idle — abort them to cut over instantly:
#   Console → Actor → Runs → abort, or POST /v2/actor-runs/{id}/abort
```

**Why the proxy is mandatory**: the MAP sites 403-block datacenter/cloud IPs (Apify runs on AWS). All upstream traffic therefore goes through **Apify Proxy `RESIDENTIAL,country-MA`** (one sticky session per run, see `src/lib/http.js`). On the free plan this consumes the $5/month credit at residential rates — realistic traffic with caching is a few tens of MB/month.

## Endpoints (v1)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/news` | Unified, deduplicated feed — `source` (`all`/`mapnews`/`map-portal`/`map-sport`/`hibasport`), `lang` (`en`/`fr`/`ar`/`es`), `section` (mapnews), `category` (WP slug), `page`, `limit` (≤50) |
| GET | `/api/v1/news/article?url=` | Full article by URL (any of the three hosts): body HTML + plain text, lead, image, city, categories, dates |
| GET | `/api/v1/search?q=` | Cross-source search — plus `source`, `lang`, `limit` |
| GET | `/api/v1/categories?source=` | Category taxonomy per source, with post counts |
| GET | `/api/v1/sections?lang=` | mapnews sections auto-discovered from the portal nav |
| GET | `/api/v1/news/archive?lang=&page=` | Deep archive from the mapnews sitemap (URLs + last-modified) |
| GET | `/api/v1/sources` | Source registry (hosts, languages, type) |
| GET | `/api/v1/health` | Per-source upstream status + cache stats |
| POST | `/api/v1/ai/summarize` | Generative AI summary — body `{ "url", "lang" }`, returns `{ engine, tldr, bullets }` |
| GET/POST | `/api/v1/admin/cache` / `clear` | Inspect / empty the cache |

Every article is normalized to one shape:

```jsonc
{
  "id": "mapnews:e0a5ad5ac5f3",      // stable, URL-derived
  "source": "mapnews",
  "lang": "en",
  "title": "…",
  "url": "https://mapnews.ma/en/actualites/politics/…",
  "section": "politique",
  "categories": ["Politics"],
  "lead": "The Houses of Representatives and Councillors will hold…",
  "summary": "…",                    // ≤ 300 chars, plain text
  "contentHtml": "<p>…</p>",         // full body on feed & article endpoints
  "contentText": "…",
  "city": "Rabat",
  "image": "https://…",
  "publishedAt": "2026-10-23T17:35:59.000Z",
  "fetchedAt": "…"
}
```

## Using it from your website

```js
// 1. Latest news (all sources, any language)
const { items } = await fetch("http://localhost:3000/api/v1/news?source=all&lang=en&limit=12").then(r => r.json());

// 2. Render cards, then load full body on click
const detail = await fetch(`/api/v1/news/article?url=${encodeURIComponent(item.url)}`).then(r => r.json());
// detail.data.contentHtml / contentText / image / lead …
```

Python:

```python
import requests
items = requests.get("http://localhost:3000/api/v1/news",
                     params={"source": "all", "lang": "fr", "limit": 10}).json()["items"]
```

Live, clickable docs are served at `/` when the server runs.

## Configuration (`.env` — copy `.env.example`)

- `PORT` — listen port (default 3000)
- `CORS_ORIGIN` — `*` by default; set to `https://yourwebsite.ma` in production
- `API_KEY` — when set, clients must send `x-api-key`
- `CACHE_TTL_LIST/ARTICLE/TAXONOMY/HOMEPAGE` — cache lifetimes (5 min / 30 min / 1 h / 6 h)
- `UPSTREAM_INTERVAL_MAPNEWS` — upstream pacing, honors mapnews.ma `robots.txt` Crawl-delay (10 s)
- `RATE_LIMIT_PER_MINUTE` — client rate limit per IP (300)
- `MAX_LIMIT` — page-size cap (50)

## Reliability & etiquette

- **Stale-while-error**: if an upstream hiccups, the last good data is served instead of a 5xx.
- **Crawl-delay respected**: mapnews.ma gets at most one upstream request per 10 s; the WordPress hosts 1 per 1.5 s. Typical steady-state load is a handful of requests per hour thanks to caching.
- **Retries with backoff** and timeouts on every upstream call.
- **Attribution**: content belongs to MAP. Display the source name and link back to the original article URL (every item carries it). This project is not affiliated with MAP; it reads the same public RSS/JSON endpoints a browser sees.

## Project layout

```
src/
├── index.js              # entry — boots server, warms caches (top feeds + WP sources)
├── actor.js              # Apify Actor entry — Standby HTTP API + regular-run dataset mode
├── server.js             # express app, routes, CORS, API key, rate limit, static site
├── config.js             # env-driven configuration
├── lib/
│   ├── http.js           # polite fetch: per-host pacing, timeout, retries
│   ├── cache.js          # TTL cache with stale-while-error
│   └── normalize.js      # article model, html→text, date parsing
├── sources/
│   ├── mapnews.js        # mapnews.ma — Drupal RSS, sections, article, sitemap, search
│   ├── wp.js             # generic WordPress REST adapter (map-portal, map-sport)
│   └── index.js          # unified registry: merge, dedupe, sort, paginate
public/
├── index.html            # the Maroc News website (served at /)
├── docs.html             # API documentation UI (served at /docs)
├── css/styles.css        # design system (dark/light, RTL, motion)
├── js/app.js             # feed, categories, search, languages, reader, theme
├── js/globe.js           # Three.js particle globe + news arcs
├── js/ai.js              # on-device AI: trending, mood, extractive summaries
└── vendor/three.min.js   # vendored Three.js r128 (no CDN dependency)
examples/                 # client snippets (curl / JS / Python)
```

### Website notes

- The site calls the API same-origin (`/api/v1/…`) — deploy both together or set a reverse proxy.
- **Cold start**: after a fresh boot, `source=all` waits on mapnews's crawl-delay-paced warm-up; the site covers this with a 30 s timeout that falls back to the fast Official feed and upgrades automatically once the portal cache is warm. The server also pre-warms the top feeds of all three languages at boot.
- **Branding**: the MAP agency name appears nowhere in the site UI by design — the only attribution is the automatic **"Source: …"** block at the very end of every article in the reader, linking back to the publisher.
- **Generative AI layer**: set `AI_API_KEY` (plus `AI_BASE_URL`/`AI_MODEL` for non-OpenAI providers — Groq, OpenRouter, Ollama, …) and the reader's *AI summary* and the `/api/v1/ai/summarize` endpoint switch from the built-in on-device extractive engine (`engine: "extractive"`) to a generative model (`engine: "generative"`, TL;DR + bullets, answered in the reader's language). With no key configured everything still works via the extractive engine — zero external calls.
- Arabic mode switches the whole layout to RTL and uses the Cairo font.
