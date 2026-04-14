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
