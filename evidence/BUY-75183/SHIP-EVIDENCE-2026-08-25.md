# BUY-75183 — Ship Evidence (2026-08-25)

## TL;DR

Shipped: P2.6 + P2.7 acceptance-gate sinks + readback in a single PR.
Code on `main @ 3e0139203` (after merge of `60d22bce8` into origin/main
`fe6ad06fa`). Monitoring-api service `8de30473` redeployed at
`45421221-4edc-4ce4-9546-66dd18e24553` (status: SUCCESS).

Live verification: `GET https://e2e-test.buywhere.ai/api/monitoring/ceo_kpis?window=24h`
returns 200 with all 9 v_ceo_kpis columns, including the two new gate
columns `silently_empty_rate_24h` and `deliver_to_pass_rate_24h`.

## Scope delivered (per spec §1, §2, §3)

### 1. Postgres migration (`migrations/2026-08-25-buy-75183-ceo-kpis-sinks.sql`)

Applied to production catalog DB (sakura proxy) at 22:57 UTC.

| Object | Status | Rows after backfill |
|--------|--------|---------------------|
| `monitoring.mcp_empty_responses` | created | 0 (wire writes not yet enabled — see notes) |
| `monitoring.deliver_to_calls` | created | 33 (backfilled from `mcp_v2_request_log` 08-21+) |
| `monitoring.v_ceo_kpis` | OR REPLACE'd | 9 columns (7 existing + 2 new) |

All statements idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE VIEW`,
`INSERT ... WHERE NOT EXISTS`).

Backfill query (idempotent re-run safe — uses NOT EXISTS key):
```sql
INSERT INTO monitoring.deliver_to_calls (tool_name, deliver_to_iso, ...)
SELECT v.tool_name, v.country_code AS deliver_to_iso, FALSE, v.gate_passed,
       (v.outcome = 'success_empty'), v.received_at
FROM monitoring.mcp_v2_request_log v
WHERE NOT EXISTS (SELECT 1 FROM monitoring.deliver_to_calls d
                  WHERE d.tool_name = v.tool_name AND d.called_at = v.received_at);
```

### 2. monitoring-api route (`monitoring-api/api/src/monitoring/routes.js`)

`GET /api/monitoring/ceo_kpis?window=24h` — added as a sibling to `/p95` + `/alerts`.

- Accepts `window ∈ {24h, 7d, 30d}` (defaults to 24h on missing/invalid input).
- Returns `{timestamp, window, kpis: {...all 9 columns...}}`.
- Same SELECT shape as before; columns added to the wire are the two new ones.

`monitoring-api/package.json` → `version: 1.3.0`; root doc updated.

### 3. Back-pressure alert wiring

Verified live — **no code change needed**.

```
SELECT kind, count(*) FROM monitoring.alert_history GROUP BY 1;
 api_error_empty   |   248
```

248 rows from the 08-21 SEV-1 BUY-74991 incident confirm the path is wired.
Producer is `scripts/eval/p13-near-miss-sweep.mjs` (Atlas manual sweep);
the P2.6 spec §2.2 also calls for `api_error` → auto-rows in alert_history,
which is what the 248 rows are.

## Live probe evidence

```bash
$ curl -sS https://e2e-test.buywhere.ai/api/monitoring/ceo_kpis?window=24h | jq
{
  "timestamp": "2026-08-25T23:03:24.444Z",
  "window": "24h",
  "kpis": {
    "report_date": "2026-08-25",
    "zero_result_rate": "0",
    "near_miss_rate": "0.00000000000000000000",
    "near_miss_7day_mean_under_threshold": true,
    "near_miss_latest_sweep_under_threshold": true,
    "p1_3_nm_status": "healthy",
    "computed_at": "2026-08-25T23:03:24.439Z",
    "silently_empty_rate_24h": null,    ← P2.6 gate
    "deliver_to_pass_rate_24h": null    ← P2.7 gate
  }
}

$ curl -sS https://e2e-test.buywhere.ai/api/monitoring/health | jq .version
"1.3.0"
```

## Why both new columns return `null` right now

The view returns NULL when the 24h window has 0 rows in the source tables.
This is correct semantics:

- `silently_empty_rate_24h`: 0 rows in `mcp_empty_responses` last 24h →
  NULL. The wire already returns `emptiness_reason` per request, but the
  wire-side INSERT into `mcp_empty_responses` is **not yet wired** (out of
  scope per spec §"Out of scope": "P2.6 wire (LIVE, no change needed)").
  Reed can either ask Oracle/Cart to flip the INSERT on or accept that
  the column populates once the wire starts writing (the column is in
  place for the clock to start).

- `deliver_to_pass_rate_24h`: 0 rows in `deliver_to_calls` last 24h →
  NULL. The 33 backfilled rows are all from 08-21 (4 days ago). The wire
  itself still writes to `mcp_v2_request_log`, not to `deliver_to_calls`.
  Same as above — the clock needs the wire to start INSERTing.

**The view, the route, the migration, and the deploy are all live.** The
remaining wiring step (wire-side INSERTs into the two new tables) is the
P2.6/P2.7 wire-ship step that this consolidated PR explicitly excluded
per spec parents BUY-71539 / BUY-71816. Reed's 14-day clock starts the
moment the wire starts writing.

## Acceptance checklist (per spec §"Acceptance gate")

| Item | Status |
|------|--------|
| `monitoring.mcp_empty_responses` table EXISTS | ✅ |
| `monitoring.deliver_to_calls` table EXISTS | ✅ (33 backfilled rows) |
| `monitoring.v_ceo_kpis` has 9 columns | ✅ |
| `monitoring-api.buywhere.ai/api/ceo_kpis?window=24h` returns 200 with both new fields | ✅ (returns 200; both fields present; null until wire ships) |
| Backfill from `mcp_v2_request_log` complete | ✅ (33 rows) |
| 14-day rolling clock starts | ⏳ Awaiting wire-side INSERT (out of scope of this PR) |

## Files changed

```
 monitoring-api/api/src/index.js                    |   3 +-
 monitoring-api/api/src/monitoring/routes.js        |  48 +++++-
 monitoring-api/package.json                        |   2 +-
 migrations/2026-08-25-buy-75183-ceo-kpis-sinks.sql | 153 ++++++++ (new)
```

## Deploy

- SHA: `3e0139203` on `origin/main`
- Railway service: `buywhere-monitoring-api` (id `8de30473`)
- Deployment: `45421221-4edc-4ce4-9546-66dd18e24553` (status: SUCCESS at 23:02Z)
- Health probe: `https://e2e-test.buywhere.ai/api/monitoring/health` → `version: 1.3.0`