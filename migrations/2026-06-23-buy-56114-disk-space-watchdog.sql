-- BUY-56114: Disk Space Watchdog (5min)
-- Table for recording disk usage snapshots per mount point.
-- Light-weight: one row per probe tick per mount.

CREATE TABLE IF NOT EXISTS monitoring.disk_space (
  id              bigserial PRIMARY KEY,
  measured_at     timestamptz NOT NULL DEFAULT now(),
  mount_point     text        NOT NULL,
  total_bytes     bigint      NOT NULL,
  used_bytes      bigint      NOT NULL,
  free_bytes      bigint      NOT NULL,
  usage_pct       numeric(5,2) NOT NULL,
  alert_threshold numeric(5,2) NOT NULL DEFAULT 85.00
);

-- Index for fast lookups of latest reading per mount
CREATE INDEX IF NOT EXISTS idx_disk_space_measured_at
  ON monitoring.disk_space (measured_at DESC);

-- Index for alerting queries (unacknowledged breaching rows)
CREATE INDEX IF NOT EXISTS idx_disk_space_mount_measured
  ON monitoring.disk_space (mount_point, measured_at DESC);
