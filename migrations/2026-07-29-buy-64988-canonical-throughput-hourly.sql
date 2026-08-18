-- BUY-64988: canonical_throughput_hourly
--
-- Reconciles ingestion_runs.rows_inserted against COUNT(products.created_at)
-- per hour and exposes a reconciliation_status column so the source_mix_freshness_check
-- guardrail can flag drift between the writer's counter and the canonical
-- products.created_at stamp.
--
-- The drift that motivated this table:
--   ingestion_runs.rows_inserted for the BUY-64337 17:00Z hour was 1,354
--   but COUNT(products.created_at) for the same hour was 0 — the writer's
--   precheck over-counted updates as inserts because the products ON CONFLICT
--   target drifted between (sku, source) and (sku, source, country_code).
--
-- The writer fix (api/src/routes/ingest.ts) now derives rows_inserted from
-- `RETURNING (xmax = 0)`, so rows_inserted should match products.created_at
-- within the same hour to within a small window of background updates.

CREATE TABLE IF NOT EXISTS canonical_throughput_hourly (
    hour                          TIMESTAMPTZ NOT NULL,
    source                        TEXT        NOT NULL,
    ingestion_runs_rows_inserted  BIGINT      NOT NULL DEFAULT 0,
    products_created_at_count     BIGINT      NOT NULL DEFAULT 0,
    gap_abs                       BIGINT      NOT NULL DEFAULT 0,
    gap_pct                       NUMERIC(8,4)         DEFAULT NULL,
    threshold_pct                 NUMERIC(8,4)         DEFAULT 10.0,
    reconciliation_status         TEXT        NOT NULL DEFAULT 'unknown',
    last_checked_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (hour, source)
);

CREATE INDEX IF NOT EXISTS idx_canonical_throughput_hour
    ON canonical_throughput_hourly (hour DESC);
CREATE INDEX IF NOT EXISTS idx_canonical_throughput_status
    ON canonical_throughput_hourly (reconciliation_status, hour DESC);

COMMENT ON TABLE canonical_throughput_hourly IS
    'BUY-64988: per-hour reconciliation of ingestion_runs.rows_inserted vs COUNT(products.created_at). Populated by scripts/source_mix_freshness_check.js.';
COMMENT ON COLUMN canonical_throughput_hourly.reconciliation_status IS
    'one of: ok | warn | drift | no_data | unknown';