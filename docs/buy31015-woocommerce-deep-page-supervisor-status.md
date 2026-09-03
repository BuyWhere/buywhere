# WooCommerce Deep-page Lane Supervisor Status (BUY-31015)

## 2026-06-23 Wake Action (BUY-56208)

**Fixed status reporting bug:** `discoveredMerchants` and `totalMerchants` were
cumulative visit counts instead of the unique merchant count. This caused the
supervisor/keep-alive to report `merchants=70/70` (the number of visits over
14 sweeps) instead of `merchants=16/16` (the actual seed inventory). Fixed in
`scripts/buy31015-woocommerce-deep-page.mjs` by adding a `uniqueMerchants`
field to `runStats` (set from `merchants.length` on startup) and using it for
both `discoveredMerchants` and `totalMerchants` in the status payload.

**Current state (2026-06-23T14:58Z):**
```
$ node scripts/buy31015-deep-page-supervisor.mjs --check
alive: pid=2301909 started=2026-06-23T14:57:25.110Z alive=yes

$ cat data/buy31015-deep-page-status.json
{
  "ts": "2026-06-23T14:58:14.308Z",
  "lane": "buy31015_woocommerce_deep",
  "cycle": 398,
  "merchantsVisited": 14,
  "rowsInserted": 0,
  "rowsUpdated": 0,
  "rowsPerHour": 0,
  "discoveredMerchants": 16,
  "totalMerchants": 16,
  "phase": "tick",
  "reason": "worker_heartbeat",
  "processId": 2301909
}
```

### Supervisor operational metrics
- **Worker Process:** Active (PID 2301909)
- **Cycle:** 398
- **Active Merchants:** 16/16 (unique seed inventory from `buy31015-wc-known-merchants.json`)
- **Keep-alive Status:** RUNNING (cron every 2 min)
- **Ingest batches:** All failing with HTTP 503 (database_schema_mismatch — owned by BUY-55081)

## Prior History

### 2026-06-22 Wake Action (BUY-55516)
Supervisor verified operational; underlying ingest batch failures are a DB-side
schema issue (BUY-55081), not a supervisor regression.

### 2026-06-22 Wake Action (BUY-55810)
Heartbeat on the recurring supervisor monitor. Spawned a fresh 720s supervisor
(pid 287188) that covered the 22:48Z + 22:56Z routine ticks.

## Architecture

- **Supervisor:** `scripts/buy31015-deep-page-supervisor.mjs`
- **Worker:** `scripts/buy31015-woocommerce-deep-page.mjs`
- **Keep-alive:** `scripts/buy31015-deep-page-keepalive.sh` (cron every 2 min)
- **Merchant data:** `data/buy31015-wc-known-merchants.json` (16 US merchants)
- **Lane env:** `data/.env.buy31015-lane` (BUYWHERE_API_URL, BUYWHERE_API_KEY)
- **Workflow:** `.github/workflows/buy31015-woocommerce-deep-page-supervisor.yml`
  (every 8 min, cron is primary)

## Open Dependency — DB Schema Guard (BUY-55081)

The worker's `POST /v1/ingest` returns HTTP 503 with body
`{"code":"database_schema_mismatch","error":"products is missing the required
UNIQUE (sku, source, country_code) conflict target; relkind=r"}`. The live DB
restarted 2026-06-21 23:59:57Z and the unique constraint was not re-applied.

While BUY-55081 is open, the worker correctly logs "ingest batch partial failure"
and continues cycling — it does not crash the lane.

### 2026-06-23 Wake Action (BUY-56327)
**Fixed keep-alive display bug:** keepalive script was reading the
cumulative `merchantsVisited` (158) from the worker status file
instead of `discoveredMerchants` (16, the unique seed inventory).
Updated `scripts/buy31015-deep-page-keepalive.sh` to read
`discoveredMerchants`. Verified after fix: `merchants=16/16`.

**Current state (2026-06-23T19:32Z):**
- Supervisor: alive, pid=1509635, started 2026-06-23T19:21:33Z
- Cycle: 480
- Keep-alive: RUNNING, cron every 2 min
- Lane: cycling through 16 unique US merchants, mostly yielding 0
  products (only `odysseybattery.com` returning 102, `biostrap.com`
  returning 5 via the public Store API)
- Ingest batches: 0 (all blocked by BUY-55081 DB schema guard)

### 2026-06-23 Wake Action (BUY-56398)
Heartbeat tick at 21:52Z. Supervisor `--check` reports worker alive
(pid=4166752, started 2026-06-23T21:42:48Z, ~10min uptime). Cycle 6,
merchants 16/16 unique (post BUY-56327 fix), merchantsVisited=142
cumulative sweep counter. Keep-alive (cron every 2min) reports
RUNNING, dead_streak=0. Last worker heartbeat 21:52:17Z (~7s ago,
fresh). Ingest API reachability OK (api.buywhere.ai/health = 200,
41ms). No restart needed. Lane state unchanged from prior ticks:
harvesting 16-merchant seed list, 14 yield 0 products via public
Store API, only `odysseybattery.com` (102) and `biostrap.com` (5)
return product payloads. Ingest batches still blocked by open
BUY-55081 DB schema guard.
