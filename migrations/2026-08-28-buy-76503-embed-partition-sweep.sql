-- BUY-76503: partition-sweep watermark table
-- The embed worker scans each country partition in order (updated_at ASC),
-- with durable watermark state so restarts resume where they left off.
-- The parent epic is BUY-76487 (incremental embed strategy).

-- Partition priority order: high-value markets get more frequent ticks.
-- All active partitions are listed; completed ones (updated_at watermark
-- older than CUTOFF_DAYS) are still scanned but skipped per-tick after
-- they report 0 candidates for N consecutive ticks.
CREATE TABLE IF NOT EXISTS embed_watermark (
  partition_name  TEXT        PRIMARY KEY,
  -- The updated_at value to scan FROM on the next tick.
  -- NULL means "not yet started — use NOW()" (first boot).
  last_updated_at TIMESTAMPTZ,
  -- When was this row last written?
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- How many rows did we actually process last time?
  rows_embedded   INTEGER     NOT NULL DEFAULT 0,
  -- Consecutive ticks that returned 0 candidates.
  -- Resets on any tick that embeds ≥1 row.
  zero_ticks      INTEGER     NOT NULL DEFAULT 0
);

COMMENT ON TABLE embed_watermark IS
  'Per-partition scan head for the BUY-76503 embed partition sweep. '
  'The worker picks one partition per tick, scans from last_updated_at '
  '(ASC) until batch_limit rows are embedded, then writes the new head back. '
  'When last_updated_at is NULL the partition has not started yet.';
