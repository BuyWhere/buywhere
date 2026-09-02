-- BUY-76714 — Merchant product feed discovery results
-- Ops apply only. Probe must not run direct DDL against catalog tables.

CREATE TABLE IF NOT EXISTS public.merchant_feeds (
    merchant_id text NOT NULL,
    feed_url text NOT NULL,
    feed_type text NOT NULL DEFAULT 'unknown',
    item_count integer NOT NULL CHECK (item_count >= 0),
    validated_at timestamptz NOT NULL DEFAULT now(),
    last_http_status integer,
    sample_item_url text,
    sample_item_title text,
    validation_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (merchant_id, feed_url)
);

CREATE INDEX IF NOT EXISTS idx_merchant_feeds_validated_at
    ON public.merchant_feeds (validated_at DESC);

CREATE INDEX IF NOT EXISTS idx_merchant_feeds_item_count
    ON public.merchant_feeds (item_count DESC);

COMMENT ON TABLE public.merchant_feeds IS
    'BUY-76714 validated merchant product feed endpoints discovered from existing merchants with products.';

COMMENT ON COLUMN public.merchant_feeds.item_count IS
    'Validated product item count observed in XML/RSS/Atom/product sitemap response at validated_at.';
