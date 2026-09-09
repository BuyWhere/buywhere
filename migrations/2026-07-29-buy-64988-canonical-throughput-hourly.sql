-- BUY-64988 / BUY-79315: canonical_throughput_hourly
--
-- Hourly canonical throughput snapshots for dispatcher_v6_hourly.js.
-- At the top of each UTC hour the dispatcher snapshots pg_stat_all_tables for
-- products plus ingestion_runs for the completed hour, then computes
-- delta_ins_from_stats as the authoritative net products-added signal used to
-- decide whether to file a failure child issue on BUY-29861.

CREATE TABLE IF NOT EXISTS canonical_throughput_hourly (
    hour_start                    TIMESTAMPTZ NOT NULL PRIMARY KEY,
    n_tup_ins                     BIGINT,
    n_tup_upd                     BIGINT,
    n_live_tup                    BIGINT,
    live_count                    BIGINT,
    ing_runs                      INTEGER     NOT NULL DEFAULT 0,
    ing_inserted                  BIGINT      NOT NULL DEFAULT 0,
    ing_updated                   BIGINT      NOT NULL DEFAULT 0,
    delta_ins_from_stats          BIGINT,
    delta_upd_from_stats          BIGINT,
    stat_reset_detected           BOOLEAN     NOT NULL DEFAULT FALSE,
    stats_mismatch_detected       BOOLEAN     NOT NULL DEFAULT FALSE,
    stats_mismatch_reason         TEXT,
    delta_computed_at             TIMESTAMPTZ,
    source                        TEXT,
    last_check_result             TEXT,
    last_check_reason             TEXT,
    recorded_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reconciliation_status         TEXT        NOT NULL DEFAULT 'unknown',
    reconciliation_gap            BIGINT,
    reconciliation_reason         TEXT,
    reconciliation_checked_at     TIMESTAMPTZ,
    drain_only_hour               BOOLEAN     NOT NULL DEFAULT FALSE,
    non_drain_runs                INTEGER     NOT NULL DEFAULT 0,
    trailing_non_drain_median     BIGINT,
    failure_issue_id              TEXT
);

CREATE INDEX IF NOT EXISTS idx_canonical_throughput_hour
    ON canonical_throughput_hourly (hour_start DESC);
CREATE INDEX IF NOT EXISTS idx_canonical_throughput_status
    ON canonical_throughput_hourly (reconciliation_status, hour_start DESC);
CREATE INDEX IF NOT EXISTS idx_canonical_throughput_result
    ON canonical_throughput_hourly (last_check_result, hour_start DESC);

COMMENT ON TABLE canonical_throughput_hourly IS
    'BUY-79315: per-hour product throughput snapshot populated by scripts/dispatcher_v6_hourly.js; delta_ins_from_stats drives BUY-29861 failure filing.';
COMMENT ON COLUMN canonical_throughput_hourly.delta_ins_from_stats IS
    'Authoritative net products-added signal computed from pg_stat_all_tables.products n_tup_ins delta between consecutive hourly snapshots.';
COMMENT ON COLUMN canonical_throughput_hourly.reconciliation_status IS
    'one of: ok | warn | drift | no_data | unknown';
