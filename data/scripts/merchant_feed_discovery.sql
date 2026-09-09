-- BUY-76714: Merchant product feeds table + GIN index for metadata extraction
-- Ops: psql $CATALOG_DSN -f merchant_feed_discovery.sql
-- NB: ingest_rw has no CREATE on public — run this as the schema owner (ops/railway).
--     Also requires: CREATE INDEX ON public.products USING gin (metadata jsonb_path_ops)
--     WHERE metadata IS NOT NULL  -- for fast feed-URL extraction from 363M-row products table

BEGIN;

-- Feeds registry
CREATE TABLE IF NOT EXISTS public.merchant_feeds (
    id              BIGSERIAL PRIMARY KEY,
    merchant_id     TEXT NOT NULL,
    merchant_domain TEXT NOT NULL,
    feed_url        TEXT NOT NULL,
    feed_type       TEXT NOT NULL,       -- 'google_shopping_xml' | 'rss' | 'atom' | 'sitemap' | 'product_feed'
    http_status     INTEGER,
    item_count      INTEGER,
    validated_at    TIMESTAMPTZ DEFAULT NOW(),
    last_checked_at TIMESTAMPTZ DEFAULT NOW(),
    is_valid        BOOLEAN,
    error_message   TEXT,
    UNIQUE(merchant_id, feed_url)
);

CREATE INDEX IF NOT EXISTS idx_merchant_feeds_merchant_id  ON public.merchant_feeds (merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_feeds_validated_at ON public.merchant_feeds (validated_at DESC);
CREATE INDEX IF NOT EXISTS idx_merchant_feeds_is_valid    ON public.merchant_feeds (is_valid) WHERE is_valid = TRUE;

-- GIN index for fast metadata feed-field extraction (required for --vectors metadata to complete under 30s)
-- Ops: apply separately if schema owner differs
-- CREATE INDEX IF NOT EXISTS idx_products_metadata_feed_fields
--     ON public.products USING gin (metadata jsonb_path_ops)
--     WHERE metadata IS NOT NULL
--     AND (metadata ? 'sitemap_index_url' OR metadata ? 'source_feed'
--          OR metadata ? 'feed_url' OR metadata ? 'product_feed');

COMMENT ON TABLE public.merchant_feeds IS
  'BUY-76714: Discovered and validated product feeds. Fleet quota: 200 validated/day. Ops schedule: merchant_feed_discovery.py --vectors sitemap,patterns';

COMMIT;
