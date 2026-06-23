# BUY-54722 — Embedding pipeline metrics endpoints

## What landed

Four new endpoints on the existing `buywhere-monitoring-api` Railway service
(8de30473-1c4f-40b5-8e0b-b47bc46d5c15):

| Endpoint | Source | Returns |
| --- | --- | --- |
| `GET /api/monitoring/embedding/pipeline_state` | vector-db `product_embeddings` + `embedding_pipeline_state` | `products_embedded`, `products_embedded_24h`, `last_embedded_at`, `first_embedded_at`, `distinct_models`, KV state rows |
| `GET /api/monitoring/embedding/cache_stats?window=1h` | Redis hash buckets `qembed:stats:<bucket>:<epoch>` | `total_lookups`, `cache_hits`, `cache_misses`, `query_embedding_cache_hit_rate`, `query_embedding_cache_miss_rate` |
| `GET /api/monitoring/embedding/p95?endpoint=search|similar&window=1h` | `monitoring.p95_latency` + `monitoring.p95_raw_measurements` | combined p95 + 5xx error rate view |
| `POST /api/monitoring/embedding/alerts/check` | evaluates above | posts incidents to the `UPTIMEROBOT_WEBHOOK_RELAY_URL` + `UPTIMEROBOT_WEBHOOK_RELAY_API_KEY` when `p95 > 600ms OR err_rate > 0.1%` |

Plus an extension to the existing handler:

- `GET /api/monitoring/p95/history?market=sg&endpoint=search|similar`
  The `endpoint` query param is optional; when provided, the rows are
  narrowed to that endpoint so the dashboard can split hybrid vs
  Find-Similar p95 in the same chart.

## Files changed

- `monitoring-api/api/src/monitoring/embedding.js` (new, 448 lines)
  All helpers + Express route registration.
- `monitoring-api/api/src/monitoring/routes.js`
  Extended `/p95/history` to accept `endpoint` query param.
- `monitoring-api/api/src/monitoring/p95.js`
  Added `VALID_ENDPOINTS`, extended `getHistory(pool, market, from, to,
  limit, endpoint)`, exported `VALID_ENDPOINTS`.
- `monitoring-api/api/src/index.js`
  Added VECTOR_DB_URL pool, REDIS_URL ioredis client, alert-relay env
  wiring, `registerEmbeddingRoutes` call, root manifest bump to v1.2.0.
- `monitoring-api/package.json` — added `ioredis@^5.3.2`, `npm test` script,
  version bump to 1.2.0.
- `monitoring-api/api/tests/embedding.test.mjs` (new, 25 tests, all passing)

## Required Railway env

Add to the `buywhere-monitoring-api` service:

- `VECTOR_DB_URL` — Postgres connection to the same vector-db the
  embed-runner writes to (`acela.proxy.rlwy.net:32575 / vectordb`).
- `REDIS_URL` — the same Redis used by `buywhere-api` for query cache.
- `UPTIMEROBOT_WEBHOOK_RELAY_URL` — the existing Paperclip relay URL.
- `UPTIMEROBOT_WEBHOOK_RELAY_API_KEY` — API key for the relay.

Without these the new endpoints gracefully return 503 with `NOT_AVAILABLE`
and a `reason` field — they never crash the prober.

## Wiring required on `buywhere-api` side

The cache-hit/miss counters and semantic p95 rows need writers. Two
follow-up edits in `api/src/routes/products.ts` and `api/src/routes/mcp.ts`:

1. **Cache counters** — in `getCachedQueryEmbedding` and the `mcp` call
   site, call `recordCacheLookup(redis, /* isHit */ cached !== null)`
   after the `redis.get` and after a successful `embedQuery`.
2. **Latency writes** — the `latencyMiddleware` already records raw
   measurements to `monitoring.p95_raw_measurements`. The endpoint tag
   it currently writes (`/mcp` or `/health`) needs to be replaced with
   `search` for `/v1/products/search` and `similar` for
   `/v1/products/:id/similar`. The prober-side
   `monitoring.p95Runner.ts` already does this correctly via the
   `endpoint` column.

These are tracked as a child follow-up so the existing PR stays scoped
to monitoring-api. See `Remaining` below.

## Verification

- `cd buywhere-api/monitoring-api && npm test` — 25/25 pass.
- Manual smoke against running server (port 52345) confirmed:
  - Root manifest lists all new endpoints.
  - `/api/monitoring/embedding/cache_stats?window=foo` → 400 INVALID_WINDOW.
  - `/api/monitoring/embedding/cache_stats?window=1h` (no REDIS_URL) →
    503 NOT_AVAILABLE with `reason: REDIS_URL not configured` (graceful).
  - `/api/monitoring/embedding/p95` (no endpoint) → 400 MISSING_ENDPOINT.

## PR

`https://github.com/BuyWhere/buywhere/pull/169`

## Remaining

- Add `VECTOR_DB_URL`, `REDIS_URL`, `UPTIMEROBOT_WEBHOOK_RELAY_URL`,
  `UPTIMEROBOT_WEBHOOK_RELAY_API_KEY` to the Railway service env.
- (Follow-up) Wire `recordCacheLookup` calls in
  `api/src/routes/products.ts` and `api/src/routes/mcp.ts`.
- (Follow-up) Tag the `latencyMiddleware` rows for `/search` /
  `/:id/similar` as endpoint=`search` / `similar` instead of the
  current `/mcp` / `/health`.
