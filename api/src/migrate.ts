import { db } from './config';

const MIGRATION = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Full-text search support on products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_products_search_vector ON products USING GIN(search_vector);

CREATE OR REPLACE FUNCTION products_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.name, '') || ' ' ||
    coalesce(NEW.description, '') || ' ' ||
    coalesce(NEW.brand, '') || ' ' ||
    coalesce(array_to_string(NEW.category_path, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.tags, ' '), '')
  );
  RETURN NEW;
END$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_search_vector_trig ON products;
CREATE TRIGGER products_search_vector_trig
BEFORE INSERT OR UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION products_search_vector_update();


-- API keys for agent access
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  agent_name TEXT NOT NULL,
  contact TEXT,
  use_case TEXT,
  tier TEXT NOT NULL DEFAULT 'free',
  rpm_limit INTEGER NOT NULL DEFAULT 60,
  daily_limit INTEGER NOT NULL DEFAULT 1000,
  signup_channel TEXT,
  attribution_source TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
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

CREATE INDEX IF NOT EXISTS idx_affiliate_links_slug ON affiliate_links(slug);

-- GEO fields for multi-region support (BUY-1970)
ALTER TABLE products ADD COLUMN IF NOT EXISTS region VARCHAR(10);
ALTER TABLE products ADD COLUMN IF NOT EXISTS country_code VARCHAR(2);
CREATE INDEX IF NOT EXISTS idx_products_region ON products(region);
CREATE INDEX IF NOT EXISTS idx_products_country_code ON products(country_code);
CREATE INDEX IF NOT EXISTS idx_products_region_active ON products(region, is_active) WHERE is_active = true;

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
  await db.query(MIGRATION);
  console.log('Migrations complete.');
  await db.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
