"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const MIGRATION = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Ensure products has all columns before any indexes or triggers reference them
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku            TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS source         TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS merchant_id    TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS description    TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_path  TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand          TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS search_vector  TSVECTOR;
ALTER TABLE products ADD COLUMN IF NOT EXISTS region         VARCHAR(10);
ALTER TABLE products ADD COLUMN IF NOT EXISTS country_code   VARCHAR(2);

-- Full-text search support on products table
CREATE INDEX IF NOT EXISTS idx_products_search_vector ON products USING GIN(search_vector);

-- Drop the old broken trigger that referenced non-existent columns (name, tags).
DROP TRIGGER IF EXISTS products_search_vector_trig ON products;
DROP FUNCTION IF EXISTS products_search_vector_update();

-- GEO indexes (now safe — is_active, region, country_code columns exist above)
CREATE INDEX IF NOT EXISTS idx_products_is_active     ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_region        ON products(region);
CREATE INDEX IF NOT EXISTS idx_products_country_code  ON products(country_code);
CREATE INDEX IF NOT EXISTS idx_products_region_active ON products(region, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_search_region  ON products USING gin(search_vector, region);
CREATE INDEX IF NOT EXISTS idx_products_search_country ON products USING gin(search_vector, country_code);

-- api_keys: create if not exists, then add any missing columns
CREATE TABLE IF NOT EXISTS api_keys (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash           TEXT        NOT NULL UNIQUE,
  name               TEXT        NOT NULL,
  tier               TEXT        NOT NULL DEFAULT 'free',
  is_active          BOOLEAN     NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rpm_limit          INTEGER     NOT NULL DEFAULT 60;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS daily_limit        INTEGER     NOT NULL DEFAULT 1000;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS signup_channel     TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS attribution_source TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS utm_source         TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS utm_medium         TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS utm_campaign       TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS contact            TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS use_case           TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS developer_id       TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at       TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_created_at ON api_keys(created_at);

-- Affiliate redirect click log
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key TEXT,
  affiliate_slug TEXT NOT NULL,
  product_id TEXT NOT NULL,
  merchant_id TEXT,
  affiliate_link_id TEXT,
  source TEXT,
  destination_url TEXT NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_api_key ON affiliate_clicks(api_key);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_product ON affiliate_clicks(product_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_clicked_at ON affiliate_clicks(clicked_at);

-- Affiliate links registry
CREATE TABLE IF NOT EXISTS affiliate_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  product_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  affiliate_link_id TEXT,
  destination_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Note: idx_affiliate_links_slug intentionally omitted — affiliate_links table already
-- exists in this DB without a slug column; the index is not applicable here.

-- GEO fields (BUY-1970, BUY-1979): columns and indexes handled at top of migration

-- Comparison pages curation table (BUY-2273)
-- product_ids: array of products.id (bigint) rows that represent this SKU across retailers
CREATE TABLE IF NOT EXISTS comparison_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  product_ids BIGINT[] NOT NULL DEFAULT '{}',
  category TEXT NOT NULL CHECK (category IN ('electronics','grocery','home','health')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  expert_summary TEXT,
  hero_image_url TEXT,
  published_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comparison_pages_published ON comparison_pages(status) WHERE status = 'published';

-- Add affiliate_url to affiliate_links if not present (BUY-2274)

-- Price refresh job log (BUY-2274)
CREATE TABLE IF NOT EXISTS price_refresh_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_skus INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  failures JSONB,
  scraper_triggered BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_price_refresh_log_ran_at ON price_refresh_log(ran_at);

-- Price history — snapshot per product per scrape run (BUY-2345)
CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'SGD',
  platform TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_product_recorded ON price_history(product_id, recorded_at DESC);

-- Query log for agent analytics dashboard (BUY-1929)
CREATE TABLE IF NOT EXISTS query_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id VARCHAR REFERENCES api_keys(id),
  agent_name TEXT,
  agent_framework TEXT NOT NULL DEFAULT 'unknown',
  sdk_language TEXT NOT NULL DEFAULT 'unknown',
  is_agent BOOLEAN NOT NULL DEFAULT true,
  endpoint TEXT NOT NULL,
  query_text TEXT,
  query_intent TEXT,
  product_categories TEXT[],
  result_count INTEGER,
  response_time_ms INTEGER,
  status_code INTEGER NOT NULL DEFAULT 200,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_log_created_at ON query_log(created_at);
CREATE INDEX IF NOT EXISTS idx_query_log_api_key_id ON query_log(api_key_id);
CREATE INDEX IF NOT EXISTS idx_query_log_agent_name ON query_log(agent_name);
CREATE INDEX IF NOT EXISTS idx_query_log_is_agent ON query_log(is_agent);
CREATE INDEX IF NOT EXISTS idx_query_log_endpoint ON query_log(endpoint);
-- Composite index for daily aggregation queries
CREATE INDEX IF NOT EXISTS idx_query_log_daily ON query_log(created_at, is_agent);
`;
async function migrate() {
    console.log('Running migrations...');
    await config_1.db.query(MIGRATION);
    console.log('Migrations complete.');
    await config_1.db.end();
    config_1.redis.disconnect();
}
migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
