-- BUY-71542: Add silently_empty_rate to public.v_ceo_kpis
-- Mirrors monitoring.v_ceo_kpis.silently_empty_rate_24h computation
-- using mcp_empty_responses table.

BEGIN;

-- Replace the public.v_ceo_kpis view with one that includes silently_empty_rate
-- The original view definition is preserved; we add a computed column from mcp_empty_responses

CREATE OR REPLACE VIEW public.v_ceo_kpis AS
WITH q AS (
  SELECT query_log.id,
     query_log.api_key_id,
     query_log.agent_name,
     query_log.agent_framework,
     query_log.sdk_language,
     query_log.is_agent,
     query_log.endpoint,
     query_log.query_text,
     query_log.query_intent,
     query_log.product_categories,
     query_log.result_count,
     query_log.response_time_ms,
     query_log.status_code,
     query_log.ip_address,
     query_log.user_agent,
     query_log.created_at,
     query_log.returned_product_ids,
     query_log.country_code,
     query_log.cache_hit,
     query_log.job_id
    FROM query_log
   WHERE query_log.created_at > (now() - '30 days'::interval)
), s AS (
  SELECT query_log.id,
     query_log.api_key_id,
     query_log.agent_name,
     query_log.agent_framework,
     query_log.sdk_language,
     query_log.is_agent,
     query_log.endpoint,
     query_log.query_text,
     query_log.query_intent,
     query_log.product_categories,
     query_log.result_count,
     query_log.response_time_ms,
     query_log.status_code,
     query_log.ip_address,
     query_log.user_agent,
     query_log.created_at,
     query_log.returned_product_ids,
     query_log.country_code,
     query_log.cache_hit,
     query_log.job_id
    FROM query_log
   WHERE query_log.endpoint = 'products.search'::text AND query_log.created_at > (now() - '30 days'::interval)
), s_nt AS (
  SELECT query_log.response_time_ms
    FROM query_log
   WHERE query_log.endpoint = 'products.search'::text AND query_log.created_at > (now() - '30 days'::interval) AND query_log.response_time_ms IS NOT NULL AND query_log.response_time_ms < 10000
), empty_window AS (
  SELECT
    count(*)                                          FILTER (WHERE TRUE) AS total_empty,
    count(*)                                          FILTER (WHERE emptiness_reason IS NULL) AS silently_empty
  FROM monitoring.mcp_empty_responses
  WHERE called_at >= NOW() - INTERVAL '24 hours'
)
SELECT now() AS measured_at,
   ( SELECT count(*) AS count
          FROM q
         WHERE q.endpoint ~~ 'mcp%'::text) AS mcp_calls_30d,
   ( SELECT count(*) AS count
          FROM q
         WHERE q.endpoint ~~ 'products.%'::text OR q.endpoint ~~ 'categories.%'::text) AS api_calls_30d,
   ( SELECT count(*) AS count
          FROM q) AS total_calls_30d,
   ( SELECT count(DISTINCT COALESCE(q.agent_name, q.api_key_id::text)) AS count
          FROM q
         WHERE q.is_agent) AS active_agents_30d,
   ( SELECT round(100.0 * avg((s.result_count > 0 AND s.status_code = 200)::integer), 1) AS round
          FROM s) AS search_nonempty_pct,
   ( SELECT round(100.0 * avg((s.result_count = 0)::integer), 1) AS round
          FROM s) AS search_zero_result_pct,
   ( SELECT round(100.0 * avg((s.status_code < 400)::integer), 1) AS round
          FROM s) AS search_http_ok_pct,
   ( SELECT percentile_disc(0.50::double precision) WITHIN GROUP (ORDER BY s_nt.response_time_ms) AS percentile_disc
          FROM s_nt) AS search_p50_ms,
   ( SELECT percentile_disc(0.95::double precision) WITHIN GROUP (ORDER BY s_nt.response_time_ms) AS percentile_disc
          FROM s_nt) AS search_p95_ms,
   ( SELECT count(*) AS count
          FROM api_keys) AS dev_keys_total,
   ( SELECT count(*) AS count
          FROM api_keys
         WHERE NOT api_keys.is_internal) AS dev_keys_external,
   ( SELECT count(DISTINCT q.api_key_id) AS count
          FROM q) AS active_keys_30d,
   ( SELECT count(*) AS count
          FROM api_keys
         WHERE NOT api_keys.is_internal AND api_keys.last_used_at > (now() - '7 days'::interval)) AS ext_weekly_active_keys,
   ( SELECT pg_class.reltuples::bigint AS reltuples
          FROM pg_class
         WHERE pg_class.relname = 'products'::name) AS products_est,
   ( SELECT count(*) AS count
          FROM merchants) AS merchants_total,
   ( SELECT count(*) AS count
          FROM merchants
         WHERE merchants.products_count > 0) AS merchants_monetizable,
   ( SELECT count(DISTINCT z.merchant_id) AS count
          FROM ( SELECT affiliate_links.merchant_id
                    FROM affiliate_links
                  LIMIT 3000000) z) AS affiliate_merchants_w_link,
   ( SELECT count(*) AS count
          FROM clicks) AS clicks_total,
   ( SELECT count(*) AS count
          FROM clicks
         WHERE clicks.clicked_at > (now() - '30 days'::interval)) AS clicks_30d,
   ( SELECT count(*) AS count
          FROM commissions
         WHERE commissions.status = ANY (ARRAY['confirmed'::text, 'paid'::text])) AS commissions_confirmed,
   ( SELECT COALESCE(sum(commissions.commission_amount), 0::numeric) AS "coalesce"
          FROM commissions
         WHERE commissions.status = ANY (ARRAY['confirmed'::text, 'paid'::text])) AS commission_amount,
   -- BUY-71542: silently_empty_rate from mcp_empty_responses (mirrors monitoring.v_ceo_kpis)
   ( SELECT
        CASE
          WHEN empty_window.total_empty = 0 THEN NULL::numeric
          ELSE round(empty_window.silently_empty::numeric / empty_window.total_empty::numeric, 6)
        END
      FROM empty_window) AS silently_empty_rate;

COMMIT;
