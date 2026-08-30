-- BUY-76718 / BUY-69340 Phase 2 design: URL-key twins between bare shopify and shopify_buy30620_crate.
-- Same-store twins only: identical normalized listing URL key. The URL host is the store boundary;
-- the full normalized URL path is the listing boundary. Same product at another store is not selected.
-- Canonical/source-label rule: keep shopify_buy30620_crate where present; bare shopify rows are losers.
-- Execution rule if approved: materialize losers into a loser table at night and write an undo list before any delete.
-- No direct DELETE/DDL is performed by this handoff SQL.

WITH url_keyed AS (
  SELECT
    id,
    source,
    merchant_id,
    sku,
    url,
    lower(regexp_replace(regexp_replace(regexp_replace(url, '^https?://', ''), '[?#].*$', ''), '/+$', '')) AS url_key,
    updated_at,
    created_at
  FROM products
  WHERE is_active = true
    AND source IN ('shopify', 'shopify_buy30620_crate')
    AND url IS NOT NULL
    AND btrim(url) <> ''
), twin_groups AS (
  SELECT url_key
  FROM url_keyed
  GROUP BY url_key
  HAVING bool_or(source = 'shopify_buy30620_crate')
     AND bool_or(source = 'shopify')
), ranked AS (
  SELECT
    u.*,
    first_value(id) OVER (
      PARTITION BY u.url_key
      ORDER BY
        CASE WHEN source = 'shopify_buy30620_crate' THEN 0 ELSE 1 END,
        updated_at DESC NULLS LAST,
        id DESC
    ) AS keep_id
  FROM url_keyed u
  JOIN twin_groups g USING (url_key)
)
SELECT
  id AS loser_id,
  keep_id,
  merchant_id,
  sku,
  url,
  url_key,
  source AS loser_source,
  'shopify_buy30620_crate' AS canonical_source
FROM ranked
WHERE source = 'shopify'
  AND id <> keep_id
ORDER BY url_key, loser_id;

-- Night-run materialization pattern for Ops after review (intentionally commented):
-- CREATE TABLE dedupe_losers_shopify_url_twins_<yyyymmdd> AS
-- <same CTEs above, selecting loser rows>;
-- \copy (SELECT * FROM dedupe_losers_shopify_url_twins_<yyyymmdd>)
--   TO '/mnt/scrape-data/dedupe_losers_shopify_url_twins_<yyyymmdd>.undo.csv' CSV HEADER;
-- Deletes must be driven only from that loser table after undo-list verification.
