-- BUY-75415: forward-direction columns the wire writer needs on the
-- existing P2.6/P2.7 sinks. BUY-75183 shipped the tables + view; this adds
-- the spec fields (query_intent, result_count, bucket) so the wire writer
-- can persist them in one INSERT per v2 tools/call.
--
-- Idempotent: every ALTER uses ADD COLUMN IF NOT EXISTS. Safe to re-run.
--
-- Why this migration:
--   - monitoring.deliver_to_calls currently only has tool_name,
--     deliver_to_iso, deliver_to_inferred, gate_passed, empty, called_at.
--     The P2.7 gate metric is deliver_to_pass_rate_24h (pass_calls / total)
--     so the existing columns are enough for the gate metric. But Reed
--     (BUY-75346 monitor + this issue) needs query_intent + result_count +
--     bucket on each row to break the metric down by intent / outcome.
--   - monitoring.mcp_empty_responses already has all the columns the
--     writer needs (tool_name, region, category, emptiness_reason,
--     confidence, engine_status, indexed_for_region, category_recognized,
--     rate_limit_remaining, called_at). No changes required here.
--
-- Pool: writes go to the primary DB (db pool in api/src/config.ts) — same
-- as the rest of the monitoring.* schema.

BEGIN;

-- 1) monitoring.deliver_to_calls forward-direction columns.
ALTER TABLE monitoring.deliver_to_calls
  ADD COLUMN IF NOT EXISTS query_intent  TEXT,
  ADD COLUMN IF NOT EXISTS result_count  INTEGER,
  ADD COLUMN IF NOT EXISTS bucket        TEXT;

-- Index for the bucket-driven counter in v_ceo_kpis (forward-direction gate
-- rules out internal probe traffic).
CREATE INDEX IF NOT EXISTS idx_deliver_to_calls_bucket_at
  ON monitoring.deliver_to_calls (called_at DESC, bucket)
  WHERE bucket IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deliver_to_calls_query_intent
  ON monitoring.deliver_to_calls (query_intent)
  WHERE query_intent IS NOT NULL;

-- 2) monitoring.mcp_empty_responses: nothing to add. Columns already cover
--    the spec. Forward comment to record why no changes were needed here.
COMMENT ON TABLE monitoring.mcp_empty_responses IS
  'BUY-75183 / BUY-75415: append-only sink for v2 tools/call responses that returned result_count=0 with a non-null emptiness_reason. Wire writer at api/src/routes/mcp.ts (case tools/call) inserts one row per matching response after the handler returns. Internal probes (is_internal=true) are filtered out before INSERT.';

COMMENT ON TABLE monitoring.deliver_to_calls IS
  'BUY-75183 / BUY-75415: append-only sink for v2 tools/call calls that returned >=1 product. Wire writer at api/src/routes/mcp.ts (case tools/call) inserts one row per matching call after the handler returns. Internal probes (is_internal=true) are filtered out before INSERT. bucket = external-agent | internal; query_intent = q | category | ids | product_name (whichever populated the call).';

COMMIT;
