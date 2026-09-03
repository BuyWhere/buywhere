# BUY-75415 — Ship Evidence (2026-08-26)

## TL;DR

Wire-side forward INSERTs are LIVE. The 14-day P2.6/P2.7 acceptance clock
for Reed (BUY-75346) can start ticking.

- Code on `fix/BUY-75345-mcp-server-v2-guard @ e9203cca3`, pushed at
  ~07:00Z 2026-08-26.
- Migration applied directly to catalog DB (sakura) at ~07:02Z.
- Railway deploy of buywhere-api at 07:02:36Z, status SUCCESS.
- Live verification at 07:03:59Z (within ~90s of the deploy):
  - `monitoring.mcp_empty_responses`: 1 row from a `search_products_v2`
    call returning `degraded+emptiness_reason=timeout`.
  - `monitoring.deliver_to_calls`: 1 row from a successful
    `search_products_v2` headphones search, with all forward-direction
    columns populated (`query_intent=headphones`, `result_count=1`,
    `bucket=external-agent`, `gate_passed=true`).
- KPI live endpoint: `GET /api/monitoring/ceo_kpis?window=24h` now returns
  `deliver_to_pass_rate_24h=1.000000` (was NULL before the gate counter
  started ticking).

## Scope delivered

### 1. Migration: `migrations/2026-08-26-buy-75415-v2-kpi-forward-columns.sql`

Applied to production catalog DB (sakura proxy) at 07:02Z via `psql`.

| Column added on `monitoring.deliver_to_calls` | Type | Default |
|---|---|---|
| `query_intent` | TEXT | NULL |
| `result_count` | INTEGER | NULL |
| `bucket` | TEXT | NULL |

Indexes added (idempotent, IF NOT EXISTS):
- `idx_deliver_to_calls_bucket_at` on `(called_at DESC, bucket)` WHERE bucket IS NOT NULL.
- `idx_deliver_to_calls_query_intent` on `(query_intent)` WHERE query_intent IS NOT NULL.

`monitoring.mcp_empty_responses` already had all columns the wire needs —
no changes required (just added a COMMENT explaining the producer).

### 2. Wire writer: `api/src/monitoring/v2KpiWriter.ts` (new, 280 lines)

Buffered fire-and-forget writer that mirrors `shoppingJobFunnel`'s pattern.

- Two row types: `DeliverToRow` (≥1 product) and `EmptyRow` (result_count=0 + reason).
- Single 2-second flush, single batched INSERT per table, single transaction.
- Internal-prefix filter (`rex-`, `monitor-`, `health-`, `atlas-`, `probe-`, `test-`)
  applied BEFORE any write — gate metric counts external-agent only.
- Failure mode: silent drop with one console.warn per failed flush (never
  blocks the JSON-RPC response; observability, not billing).

### 3. Wire hook: `api/src/routes/mcp.ts`

- New import: `recordV2KpiSink` from `monitoring/v2KpiWriter`.
- Invocation at both v2 success sites:
  - `case 'tools/call'` block — after `funnelJobId` injection, before `res.json`.
  - `default` (BUY-72102 backward-compat direct-method) — same placement.
- Wrapped in `try { ... } catch { /* swallowed */ }` for belt-and-braces;
  writer already swallows internally.

## Live verification (curl evidence)

### Probe 1: `search_products_v2` with `deliver_to=SG, q=headphones` (07:03:59Z)

Response meta: `degraded=true, emptiness_reason=timeout, confidence=low,
engine_status=degraded, indexed_for_region=true, category_recognized=false,
timed_out_stage=catalog_search`.

```sql
SELECT tool_name, region, emptiness_reason, confidence, engine_status,
       indexed_for_region, category_recognized, rate_limit_remaining,
       called_at
  FROM monitoring.mcp_empty_responses
 WHERE called_at >= NOW() - INTERVAL '5 minutes';
```

```
     tool_name      | region | emptiness_reason | confidence | engine_status | indexed_for_region | category_recognized | rate_limit_remaining |         called_at
--------------------+--------+------------------+------------+---------------+--------------------+---------------------+----------------------+----------------------------
 search_products_v2 | SG     | timeout          | low        | degraded      | t                  | f                   |                      | 2026-08-26 07:03:59.818+00
```

✅ Forward-direction INSERT confirmed in <3s after the call returned.

### Probe 2: `search_products_v2` with `deliver_to=SG, q=headphones` (07:04:34Z)

Response: 1 product returned. Forward-direction row written:

```sql
SELECT tool_name, deliver_to_iso, deliver_to_inferred, gate_passed, empty,
       query_intent, result_count, bucket, called_at
  FROM monitoring.deliver_to_calls
 WHERE called_at >= NOW() - INTERVAL '5 minutes';
```

```
     tool_name      | deliver_to_iso | deliver_to_inferred | gate_passed | empty | query_intent | result_count |     bucket     |         called_at
--------------------+----------------+---------------------+-------------+-------+--------------+--------------+----------------+----------------------------
 search_products_v2 | SG             | f                   | t           | f     | headphones   |            1 | external-agent | 2026-08-26 07:04:34.263+00
```

✅ All forward-direction columns populated correctly.

### Probe 3: `search_products_v2` with `deliver_to=ZZ` (07:05:01Z)

`invalid_deliver_to` envelope (BUY-72700); second row written to
`monitoring.mcp_empty_responses` with `region=ZZ, emptiness_reason=invalid_deliver_to`.

### Probe 4 (negative): `search_products` (v1, no `_v2` suffix) (07:05:24Z)

Returned 1 product (via v1 handler). deliver_to_calls row count unchanged
(still 1). Confirms v1 is NOT written — only `_v2` tools.

### Live KPI

```
GET https://e2e-test.buywhere.ai/api/monitoring/ceo_kpis?window=24h

{
  "timestamp": "2026-08-26T07:04:50.494Z",
  "window": "24h",
  "kpis": {
    "report_date": "2026-08-26",
    "zero_result_rate": "0",
    "near_miss_rate": "0.00000000000000000000",
    "near_miss_7day_mean_under_threshold": true,
    "near_miss_latest_sweep_under_threshold": true,
    "p1_3_nm_status": "healthy",
    "computed_at": "2026-08-26T07:04:50.483Z",
    "silently_empty_rate_24h": "0.000000",
    "deliver_to_pass_rate_24h": "1.000000"
  }
}
```

`deliver_to_pass_rate_24h=1.000000` — the gate counter is now NON-NULL and
computing. The 14-day clock can start at this moment.

## Deploy

- Commit: `e9203cca3` on `fix/BUY-75345-mcp-server-v2-guard`.
- Railway deploy ID: `a193a80a-ab03-42db-912a-c00453a25028`.
- Created at: `2026-08-26T07:02:36.944Z`. Status: SUCCESS.
- Service: `buywhere-api` (id 945e8a6d-...).

## Acceptance criteria checklist

| Criterion | Status |
|---|---|
| v2 ≥1 product → `monitoring.deliver_to_calls` (tool_name, deliver_to, query_intent, result_count, called_at, bucket) | ✅ |
| v2 result_count=0 + reason → `monitoring.mcp_empty_responses` | ✅ |
| Internal probes (is_internal) filtered out before INSERT | ✅ |
| External-agent call → row within 60s | ✅ (~3s observed) |
| Live KPI `deliver_to_pass_rate_24h` non-null | ✅ |
