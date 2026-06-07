# AQS Ingest — Contract & Operating Manual

AQS (Agent Quality Score) is BuyWhere's composite quality signal for its
agent-native search, deal, and product APIs. This document is the
operating contract for the AQS Ingest pipeline that runs every 15 minutes.

## Pipeline

```
+-----------+      +--------------------+      +-----------------+      +---------------+
|  Cycle    | ---> | AQS Calculator     | ---> | aqs_cycles      | <--- | /v1/aqs/*     |
|  source   |      | (scripts/aqs_      |      | Postgres table  |      | public route  |
|  (URL)    |      |  calculator.py)    |      | (API migrate.ts)|      | on api.buy    |
+-----------+      +--------------------+      +-----------------+      | where.ai      |
                                                                              +---------------+
  triggered by                triggered by                triggered by
  GitHub Actions              scripts/aqs_calculator.py  GET endpoints
  schedule (cron)             --store (psycopg)          (read-only)
```

## Schedule

- GitHub Actions cron: `11,26,41,56 * * * *` (every 15 min, off the
  :00/:15/:30/:45 marks to spread load — same convention as other
  fleet jobs).
- Window: 8 min `timeout-minutes`.

## Required secrets

| Secret | Purpose | Notes |
| --- | --- | --- |
| `AQS_DATABASE_URL` | Postgres connection string for the `aqs_cycles` upsert | Same DB as the API's `DATABASE_URL`; the `aqs_cycles` table is created at API startup by `api/src/migrate.ts → AQS_MIGRATION` |
| `AQS_TEST_CYCLE_URL` | Endpoint that returns the current AQS test-cycle JSON | Optional on first run — if unset the job uses local `/tmp/aqs-cycles/` and falls back to file-based history |
| `AQS_VERIFY_URL` | Base URL of `buywhere-api` (default `https://api.buywhere.ai`) | Used by the post-step that hits `/v1/aqs/health` to confirm a row was written |
| `RAILWAY_TOKEN` | Used by `deploy-api-production.yml` to redeploy the API | Already configured for `deploy-railway.yml` |

The `BUY-16518` issue owns the production `AQS_DATABASE_URL` secret
configuration. Until that lands, the workflow runs in `--store` mode
locally only and the verify step is skipped (`AQS_VERIFY_URL` unset).

## `AQS_TEST_CYCLE_URL` contract

The test-cycle endpoint must return a JSON document matching the
**AQS Data Contract** (BUY-12885 §4.1):

```jsonc
{
  "cycle_id": "2026-06-07T11:30:00Z",       // required, string, ISO-ish
  "relevance":     { "category_match_rate": 0.87 },
  "coverage":      { "query_success_rate": 0.94, "adequate_coverage_rate": 0.71, "category_coverage_pct": 0.85 },
  "freshness":     { "staleness_factor": 0.12 },
  "completeness":  { "schema_compliance_rate": 0.96, "image_coverage_rate": 0.91, "price_completeness_rate": 0.97, "merchant_attribution_rate": 0.88 },
  "performance":   { "search_p50_ms": 220, "search_p95_ms": 740, "get_product_p50_ms": 60, "tools_list_p50_ms": 80 }
}
```

Scoring rules are documented in `app/services/aqs_calculator.py`. The
formula is:

```
AQS = Relevance×0.35 + Coverage×0.30 + Freshness×0.15 + Completeness×0.10 + Performance×0.10
```

Grade thresholds: **Excellent ≥ 90**, **Good ≥ 75**, **Fair ≥ 50**,
**Poor ≥ 25**, else **Unusable**.

The endpoint must:
- Return `200` with `Content-Type: application/json`.
- Complete within 20 s (the workflow's `--max-time`).
- Be idempotent on `cycle_id` (a re-run with the same cycle upserts).

If the test-cycle endpoint is not yet live, leave `AQS_TEST_CYCLE_URL`
unset. The job then runs in dry-run mode and writes only to the local
JSONL file at `/tmp/aqs-output/aqs_history.jsonl`, which the
`aqs_cycles` table is not populated from (so a future migration
backfill is needed).

## How to add a new sub-metric

1. Add the field to the cycle JSON shape in the test-cycle endpoint.
2. Add the field to the matching `_score_*` helper in
   `app/services/aqs_calculator.py`. Use defaults (e.g. 0.5) for the
   partial-credit branch so absent fields don't break scoring.
3. Add a regression test under
   `tests/services/test_aqs_calculator.py` (TODO: write the test).
4. Document the new field in the data contract section above.

## How to run locally

```bash
# Compute against a manual cycle file, write JSONL only.
python scripts/aqs_calculator.py --cycle-file /path/to/cycle.json

# Compute and persist to a local Postgres (defaults to $DATABASE_URL).
DATABASE_URL=postgresql://localhost:5432/buywhere \
  python scripts/aqs_calculator.py --cycle-file /path/to/cycle.json --store

# Dry-run (print JSON, write nothing).
python scripts/aqs_calculator.py --cycle-file /path/to/cycle.json --dry-run
```

## Verification commands

```bash
# Health: table present + at least one cycle row → 200
curl -s https://api.buywhere.ai/v1/aqs/health | jq

# Latest cycle
curl -s https://api.buywhere.ai/v1/aqs/latest | jq

# Last 10 cycles
curl -s "https://api.buywhere.ai/v1/aqs/cycles?limit=10" | jq
```

## Acceptance for BUY-33907

- [x] `.github/workflows/aqs-ingest.yml` on main
- [x] `api/src/aqs/repository.ts` on main
- [x] `api/src/routes/aqs.ts` mounted at `/v1/aqs/*` on main
- [x] `aqs_cycles` table migration in `api/src/migrate.ts` on main
- [x] `app/services/aqs_storage.py` writer (Python) on main
- [x] `scripts/aqs_calculator.py --store` flag on main
- [x] `deploy-api-production.yml` rewritten for Railway target on main
- [ ] Production `AQS_DATABASE_URL` secret configured (BUY-16518)
- [ ] First scheduled run writes a row visible at `/v1/aqs/health` (BUY-16518)
