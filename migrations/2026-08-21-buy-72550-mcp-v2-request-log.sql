-- BUY-72550 (Atlas) — Server-side v2 adoption log
-- See: https://paperclip.richteo.com/issues/BUY-72550
-- Sibling of BUY-72531 (parent), BUY-72533 (Rex wire), BUY-72535 (Cart sweep).
--
-- PURPOSE
-- The p27 sweep (BUY-72535) measures v2 deliver_to adoption from a Cart-controlled
-- probe, which by construction reports ~1.0 once Rex's wire lands. The 7-day
-- acceptance gate (≥ 0.80 deliver_to_pass_rate by 2026-09-22Z) cannot be
-- evaluated against probe traffic alone; we need real-agent adoption telemetry.
--
-- This migration defines:
--   monitoring.mcp_v2_request_log  — per-request row written by the API process
--                                     for every incoming JSON-RPC tools/call
--                                     whose `params.name` ends in `_v2`.
--   monitoring.v2_adoption_daily  — daily rollup view Atlas's aggregator reads
--                                     to emit data/v2-adoption-server-side/*.csv.
--
-- WIRING (Rex, BUY-72533 follow-up — child BUY-72550-WIRE-LOG)
-- The API process MUST insert one row per incoming v2 tools/call. Insertion
-- happens AFTER the gate decision but BEFORE returning the JSON-RPC response,
-- so gate_rejected rows are still recorded (they are part of the population).
-- Writes go through a small async queue + 5-second batch flush to avoid adding
-- per-request latency. The insert path lives in app/usage_metering.py (which
-- is currently a stub — see that file for the proposed implementation).
--
-- SCOPE
-- The JSON-RPC `tools/call` envelope in the live wire does NOT include an
-- `arguments.api_version` discriminator. v1 vs v2 is signalled by the tool name
-- suffix (`_v2`). The log writer discriminates by `params.name` ending in `_v2`,
-- not by an `api_version` argument (which does not exist in BUY-72531 spec
-- either — the v2 wire is the suffix, not a field).
--
-- NON-GOALS
-- - This migration does NOT add server-card or schema changes; only telemetry.
-- - This migration does NOT add the API-side write path; that is Rex's wire work.
-- - This migration does NOT modify existing monitoring.* tables or data.

BEGIN;

-- ---------------------------------------------------------------------------
-- monitoring.mcp_v2_request_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitoring.mcp_v2_request_log (
    id                  BIGSERIAL    PRIMARY KEY,
    request_id          TEXT         NOT NULL,            -- JSON-RPC `id`, or upstream X-Request-Id
    tool_name           TEXT         NOT NULL,            -- search_products_v2, find_best_price_v2, etc.
    deliver_to_present  BOOLEAN      NOT NULL,            -- arguments.deliver_to non-empty
    country_code        TEXT             NULL,            -- arguments.deliver_to || arguments.country_code || arguments.country
    gate_passed         BOOLEAN      NOT NULL,            -- server-side v2 gate did not fire (-32602)
    outcome             TEXT         NOT NULL,            -- 'success' | 'gate_rejected' | 'rpc_error' | 'transport_error'
    api_key_hash        TEXT             NULL,            -- sha256(api_key)[:16] for cardinality bucketing, NOT the key itself
    received_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_v2_request_log_received_at
    ON monitoring.mcp_v2_request_log (received_at);
CREATE INDEX IF NOT EXISTS idx_mcp_v2_request_log_received_tool
    ON monitoring.mcp_v2_request_log (received_at, tool_name);
CREATE INDEX IF NOT EXISTS idx_mcp_v2_request_log_received_outcome
    ON monitoring.mcp_v2_request_log (received_at, outcome);

COMMENT ON TABLE monitoring.mcp_v2_request_log IS
    'BUY-72550: per-request telemetry for JSON-RPC tools/call hitting v2 tools (params.name suffix _v2). Written by app/usage_metering.py on the API process. Atlas rolls this up daily at ~23:55Z to monitoring.v2_adoption_daily and data/v2-adoption-server-side/YYYY-MM-DD.csv.';

COMMENT ON COLUMN monitoring.mcp_v2_request_log.tool_name IS
    'Tool name from JSON-RPC params.name. Must end with _v2 to be inserted here; v1 tools are NOT logged (no deliver_to adoption concern on v1).';

COMMENT ON COLUMN monitoring.mcp_v2_request_log.deliver_to_present IS
    'True iff arguments.deliver_to is a non-empty string. Per BUY-72531 spec, deliver_to is REQUIRED for all v2 tools; absent == gate_rejected.';

COMMENT ON COLUMN monitoring.mcp_v2_request_log.gate_passed IS
    'True iff the v2 deliver_to gate did NOT fire. gate_rejected rows have deliver_to_present=false AND gate_passed=false. Useful for: (gate_rejected / total) is the v2 gate-miss rate, NOT the deliver_to pass rate — those are different metrics.';

COMMENT ON COLUMN monitoring.mcp_v2_request_log.outcome IS
    'one of: success | gate_rejected | rpc_error | transport_error. gate_rejected = -32602 from deliver_to enforcement; transport_error = timeout/connect refused; rpc_error = other -32xxx codes.';

COMMENT ON COLUMN monitoring.mcp_v2_request_log.api_key_hash IS
    'First 16 hex chars of sha256(api_key). Used for cardinality bucketing; NEVER store the API key itself. NULL if the request was unauthenticated (rejected at the auth layer before reaching the tool dispatcher).';

-- ---------------------------------------------------------------------------
-- monitoring.v2_adoption_daily (rollup view)
-- ---------------------------------------------------------------------------
-- Aggregated per UTC day. Mirrors the p13 monitoring.uptime_daily shape and
-- follows the column naming convention Cart's p27 sweep uses.
CREATE OR REPLACE VIEW monitoring.v2_adoption_daily AS
SELECT
    date_trunc('day', received_at AT TIME ZONE 'UTC')::date       AS day,
    tool_name,
    COUNT(*)                                                      AS total_v2_calls,
    COUNT(*) FILTER (WHERE deliver_to_present)                    AS calls_with_deliver_to,
    COUNT(*) FILTER (WHERE gate_passed)                           AS calls_gate_passed,
    COUNT(*) FILTER (WHERE outcome = 'gate_rejected')             AS calls_gate_rejected,
    COUNT(*) FILTER (WHERE outcome = 'transport_error')           AS calls_transport_error,
    ROUND(
        COUNT(*) FILTER (WHERE deliver_to_present)::numeric
        / NULLIF(COUNT(*), 0), 4
    )                                                             AS deliver_to_pass_rate,
    ROUND(
        COUNT(*) FILTER (WHERE gate_passed)::numeric
        / NULLIF(COUNT(*), 0), 4
    )                                                             AS gate_pass_rate,
    COUNT(DISTINCT api_key_hash)                                  AS distinct_api_keys
FROM monitoring.mcp_v2_request_log
GROUP BY 1, 2;

COMMENT ON VIEW monitoring.v2_adoption_daily IS
    'BUY-72550: per-day, per-tool rollup of monitoring.mcp_v2_request_log. deliver_to_pass_rate = calls_with_deliver_to / total_v2_calls. Atlas aggregates this to data/v2-adoption-server-side/YYYY-MM-DD.csv.';

COMMIT;