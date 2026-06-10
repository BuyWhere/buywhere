# BUY-38909 Ingestion Pipeline Health Check

- Generated at: `2026-06-10T16:07:36.333Z`
- Execution issue: `BUY-38909`
- Parent monitoring: `BUY-12992`
- Result: `WARN`
- Stale threshold: `24h`
- Fix mode: `enabled — 0 zombie run(s) marked failed`

## 1. /v1/ingest/health liveness

- ✓ GET /v1/ingest/health → 200 (40ms)

## 2. Database connectivity

- ✓ PostgreSQL reachable (20ms)

## 3. Zombie ingestion runs (> 1h in 'running')

None.

## 4. Per-market freshness

| Market | Products | Updated 1h | Updated 24h | Last updated | Age (h) | Runs 24h | Failed 24h | Success rate | Status |
|--------|----------|------------|-------------|--------------|---------|----------|------------|--------------|--------|
| SG | 5,242 | 0 | 1 | 2026-06-10T10:29:15.882Z | 5.6 | 0 | 0 | - | fresh |
| US | 9,073 | 108 | 108 | 2026-06-10T16:07:22.992Z | 0.0 | 0 | 0 | - | fresh |
| MY | 9,888 | 0 | 0 | 2026-06-09T08:16:12.297Z | 31.9 | 0 | 0 | - | stale |
| VN | 0 | 0 | 0 | - | - | 0 | 0 | - | stale |
| TH | 4,509 | 0 | 0 | 2026-06-09T09:37:00.399Z | 30.5 | 0 | 0 | - | stale |
| ID | 0 | 0 | 0 | - | - | 0 | 0 | - | stale |
| PH | 0 | 0 | 0 | - | - | 0 | 0 | - | stale |

## 5. Source-level failure alerts (last 24h)

| Source | Failures | Partials | Zombie | Rows failed | Last error |
|--------|----------|----------|--------|-------------|------------|
| woocommerce_deep | 19 | 0 | 0 | 0 | null value in column "region" of relation "products_sg" violates not-null constr |
