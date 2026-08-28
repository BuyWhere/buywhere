import { db, redis } from './config';

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
ALTER TABLE products ADD COLUMN IF NOT EXISTS gtin           VARCHAR(14);
ALTER TABLE products ADD COLUMN IF NOT EXISTS mpn            VARCHAR(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS avg_rating     NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_count   INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS url_status     TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE products ADD COLUMN IF NOT EXISTS url_last_checked_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS url_status_reason TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS url_dead_at     TIMESTAMPTZ;

-- Full-text search support on products table
CREATE INDEX IF NOT EXISTS idx_products_search_vector ON products USING GIN(search_vector);

-- BUY-56217: unique constraint is now created in PRODUCTS_UNIQUE_CONSTRAINT_DDL (own try/catch) so a failure in any other migration statement can't block ingest.



-- Drop the old broken trigger that referenced non-existent columns (name, tags).
DROP TRIGGER IF EXISTS products_search_vector_trig ON products;
DROP FUNCTION IF EXISTS products_search_vector_update() CASCADE;

-- GEO indexes (now safe — is_active, region, country_code columns exist above)
CREATE INDEX IF NOT EXISTS idx_products_is_active     ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_region        ON products(region);
CREATE INDEX IF NOT EXISTS idx_products_country_code  ON products(country_code);
CREATE INDEX IF NOT EXISTS idx_products_region_active ON products(region, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_search_region  ON products USING gin(search_vector, region);
CREATE INDEX IF NOT EXISTS idx_products_search_country ON products USING gin(search_vector, country_code);
CREATE INDEX IF NOT EXISTS idx_products_currency     ON products(currency);
CREATE INDEX IF NOT EXISTS idx_products_currency_price ON products(currency, price) WHERE price > 0;
CREATE INDEX IF NOT EXISTS idx_products_category_path ON products USING GIN(category_path);

-- BUY-14332: discount_pct generated column handled separately in runMigrations()
-- with an extended statement_timeout (5 min) to avoid timeout on 14M row tables.

-- BUY-14399: Deals cold-path optimization indexes for country/region filtering
-- These indexes optimize /v1/deals queries that filter by country_code or region
-- with discount percentage sorting, avoiding sequential scans on 14M+ row table.
CREATE INDEX IF NOT EXISTS idx_products_deals_country ON products (
  currency,
  country_code,
  (((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100)),
  updated_at DESC
) WHERE is_active = true
    AND price > 0
    AND (metadata->>'original_price') ~ '^[0-9]+(\\.[0-9]+)?$'
    AND (metadata->>'original_price')::numeric > price
    AND (metadata->>'original_price')::numeric < price * 100;

CREATE INDEX IF NOT EXISTS idx_products_deals_region ON products (
  currency,
  region,
  (((1 - price / NULLIF((metadata->>'original_price')::numeric, 0)) * 100)),
  updated_at DESC
) WHERE is_active = true
    AND price > 0
    AND (metadata->>'original_price') ~ '^[0-9]+(\\.[0-9]+)?$'
    AND (metadata->>'original_price')::numeric > price
    AND (metadata->>'original_price')::numeric < price * 100;

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
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS contact                     TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS email                       TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS use_case                    TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS developer_id                TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at                 TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS email_verified               BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS email_verification_token     TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS email_verification_sent_at   TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS daily_request_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS daily_reset_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 day');
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS weekly_request_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS weekly_reset_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days');
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS consecutive_outbound_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_outbound_date DATE;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS failed_request_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS registration_ip TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS keys_from_same_ip_24h INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_prefix          TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS label               TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS fingerprint_hash    TEXT;

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE is_active = true;

-- Backfill: mark existing keys with a contact email as verified
UPDATE api_keys SET email_verified = true WHERE contact IS NOT NULL AND contact != '' AND email_verified = false;

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_email_token ON api_keys(email_verification_token) WHERE email_verification_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_created_at ON api_keys(created_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_pending_verify ON api_keys(tier, created_at) WHERE tier = 'pending_verify';

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
ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS was_dead_at_click BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS agent_framework TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS ip_hash TEXT;
ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS referrer TEXT;
ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS source_page TEXT;
ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS api_key_id TEXT;
ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

-- Append-only outbound URL probe history. Current status lives on products for fast render-gates.
CREATE TABLE IF NOT EXISTS url_probe_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id TEXT NOT NULL,
  merchant_id TEXT,
  url TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  http_status INTEGER,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latency_ms INTEGER,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_api_key ON affiliate_clicks(api_key);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_product ON affiliate_clicks(product_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_clicked_at ON affiliate_clicks(clicked_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_truth
  ON affiliate_clicks(clicked_at, agent_framework, is_internal);
CREATE INDEX IF NOT EXISTS idx_url_probe_log_product_checked_at ON url_probe_log(product_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_url_probe_log_status_checked_at ON url_probe_log(status, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_url_probe_due ON products(url_last_checked_at) WHERE is_active = true AND url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_url_status ON products(url_status);

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

-- BUY-18436: per-platform affiliate config table (hot-reloadable, feature-flagged)
CREATE TABLE IF NOT EXISTS affiliate_platform_config (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform    TEXT        NOT NULL UNIQUE,  -- e.g. 'shopee_sg', 'lazada_sg'
  network_id  TEXT        NOT NULL,         -- e.g. 'accesstrade', 'involve_asia'
  tracking_id TEXT        NOT NULL,         -- publisher/sub-ID on that network
  is_active   BOOLEAN     NOT NULL DEFAULT false,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed placeholder configs for Shopee SG and Lazada SG (inactive by default)
INSERT INTO affiliate_platform_config (platform, network_id, tracking_id, is_active, notes)
VALUES
  ('shopee_sg', 'involve_asia', 'PLACEHOLDER_SHOPEE_SG', false, 'Swap tracking_id when BUY-13765 resolves'),
  ('lazada_sg',  'involve_asia', 'PLACEHOLDER_LAZADA_SG',  false, 'Swap tracking_id when BUY-13765 resolves')
ON CONFLICT (platform) DO NOTHING;

-- BUY-14356: index on (product_id, merchant_id) for the LEFT JOIN in product search/deals queries
CREATE INDEX IF NOT EXISTS idx_affiliate_links_product_merchant ON affiliate_links(product_id, merchant_id);

-- B-tree index on category_path[1] for fast GROUP BY / WHERE queries (BUY-8715)
CREATE INDEX IF NOT EXISTS idx_products_category_path_first ON products USING btree ((category_path[1]));

-- Backfill empty category_path to prevent 0-category results (BUY-8715)
UPDATE products SET category_path = ARRAY['Uncategorized']::text[]
WHERE category_path = '{}' OR array_length(category_path, 1) = 0;

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

-- BUY-60005: products.id is BIGINT, so comparison_pages.product_ids MUST be BIGINT[].
-- An earlier migration (BUY-2270) aligned this column to UUID[], which silently dropped
-- every seeded product_id (the seed inserts BIGINT[] values), leaving all rows with {}.
-- That made /v1/compare/:slug return 404 for every comparison page. Align to BIGINT[]
-- and recover any product_ids still stored as UUID text (best-effort cast to BIGINT).
DO $$
DECLARE col_type TEXT;
BEGIN
  SELECT udt_name INTO col_type
  FROM information_schema.columns
  WHERE table_name = 'comparison_pages' AND column_name = 'product_ids';
  IF col_type = '_uuid' THEN
    ALTER TABLE comparison_pages ALTER COLUMN product_ids DROP DEFAULT;
    -- UUID text → BIGINT: strip non-digits and cast. Non-numeric UUIDs become NULL (dropped).
    ALTER TABLE comparison_pages ALTER COLUMN product_ids TYPE BIGINT[]
      USING ARRAY(SELECT CASE WHEN v ~ '^[0-9]+$' THEN v::BIGINT ELSE NULL END
                  FROM unnest(product_ids::text[]) AS v);
    ALTER TABLE comparison_pages ALTER COLUMN product_ids SET DEFAULT '{}';
  END IF;
END$$;

-- Add affiliate_url to affiliate_links if not present (BUY-2274, BUY-60824)
ALTER TABLE affiliate_links ADD COLUMN IF NOT EXISTS affiliate_url TEXT;

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
  returned_product_ids TEXT[],
  response_time_ms INTEGER,
  status_code INTEGER NOT NULL DEFAULT 200,
  ip_address INET,
  user_agent TEXT,
  cache_hit BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_log_created_at ON query_log(created_at);
CREATE INDEX IF NOT EXISTS idx_query_log_api_key_id ON query_log(api_key_id);
CREATE INDEX IF NOT EXISTS idx_query_log_agent_name ON query_log(agent_name);
CREATE INDEX IF NOT EXISTS idx_query_log_is_agent ON query_log(is_agent);
CREATE INDEX IF NOT EXISTS idx_query_log_endpoint ON query_log(endpoint);
-- Composite index for daily aggregation queries
CREATE INDEX IF NOT EXISTS idx_query_log_daily ON query_log(created_at, is_agent);

-- Outbound click tracking (BUY-4869): user-facing /api/click redirect logs
-- Distinct from affiliate_clicks (affiliate programme tracking via /r/:slug/:productId)
CREATE TABLE IF NOT EXISTS clicks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      TEXT,
  merchant_id     TEXT,
  user_id         TEXT,           -- null when unauthenticated
  api_key         TEXT,           -- from Authorization header if present
  referrer        TEXT,
  destination_url TEXT        NOT NULL,
  ip_hash         TEXT,           -- SHA-256 of client IP, never raw
  source          TEXT        DEFAULT 'click_endpoint',
  clicked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure merchant_id column exists on clicks table (BUY-8716: handle pre-existing tables)
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS merchant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_clicks_product    ON clicks(product_id);
CREATE INDEX IF NOT EXISTS idx_clicks_merchant   ON clicks(merchant_id);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at);

-- fx_rates table for live FX rate storage (BUY-54078 / BUY-52476)
-- Primary source: frankfurter.app (ECB rates, free, keyless)
-- Fallback source: open.er-api.org (free tier, keyless)
-- Refresh cadence: every 6 hours via fxRefreshScheduler
CREATE TABLE IF NOT EXISTS fx_rates (
  id              BIGSERIAL PRIMARY KEY,
  base_currency   TEXT          NOT NULL,  -- e.g. 'EUR'
  quote_currency  TEXT          NOT NULL,  -- e.g. 'USD'
  rate            NUMERIC(20,10) NOT NULL, -- units of target per 1 base
  source          TEXT          NOT NULL,  -- 'frankfurter' | 'open.er-api'
  fetched_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT fx_rates_pair_unique UNIQUE (base_currency, quote_currency)
);
CREATE INDEX IF NOT EXISTS idx_fx_rates_currencies ON fx_rates(base_currency, quote_currency);
CREATE INDEX IF NOT EXISTS idx_fx_rates_fetched_at ON fx_rates(fetched_at DESC);

-- Merchants onboarding table (BUY-6932)
CREATE TABLE IF NOT EXISTS merchants (
  id              TEXT        PRIMARY KEY,
  name            TEXT        NOT NULL,
  source          TEXT        NOT NULL,
  country         VARCHAR(2)  NOT NULL DEFAULT 'SG',
  domain          TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  scraping_priority TEXT     DEFAULT 'medium',
  is_active       BOOLEAN    NOT NULL DEFAULT true,
  onboarding_stage TEXT      NOT NULL DEFAULT 'interested',
  first_indexed_at TIMESTAMPTZ,
  products_count  INTEGER,
  last_scraped_at  TIMESTAMPTZ,
  scrape_error    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchants_source ON merchants(source);
CREATE INDEX IF NOT EXISTS idx_merchants_onboarding_stage ON merchants(onboarding_stage);
CREATE INDEX IF NOT EXISTS idx_merchants_country ON merchants(country);

-- Merchant events log (BUY-6932)
CREATE TABLE IF NOT EXISTS merchant_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     TEXT        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL,
  event_data      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchant_events_merchant_id ON merchant_events(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_events_event_type ON merchant_events(event_type);
`;

// Merchants tables — created separately from main migration so they
// are not blocked if an earlier migration statement fails.
const MERCHANTS_MIGRATION = `
CREATE TABLE IF NOT EXISTS merchants (
  id              TEXT        PRIMARY KEY,
  name            TEXT        NOT NULL,
  source          TEXT        NOT NULL,
  country         VARCHAR(2)  NOT NULL DEFAULT 'SG',
  domain          TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  scraping_priority TEXT     DEFAULT 'medium',
  is_active       BOOLEAN    NOT NULL DEFAULT true,
  onboarding_stage TEXT      NOT NULL DEFAULT 'interested',
  first_indexed_at TIMESTAMPTZ,
  products_count  INTEGER,
  last_scraped_at  TIMESTAMPTZ,
  scrape_error    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchants_source ON merchants(source);
CREATE INDEX IF NOT EXISTS idx_merchants_onboarding_stage ON merchants(onboarding_stage);
CREATE INDEX IF NOT EXISTS idx_merchants_country ON merchants(country);

CREATE TABLE IF NOT EXISTS merchant_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     TEXT        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL,
  event_data      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchant_events_merchant_id ON merchant_events(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_events_event_type ON merchant_events(event_type);
`;

// BUY-56217: Unique conflict target (sku, source, country_code) on products table.
// The schema guard in api/src/routes/ingest.ts requires a valid unique index to exist;
// without it, POST /v1/ingest returns 503 database_schema_mismatch for every source
// that uses ON CONFLICT (sku, source, country_code) (e.g. woocommerce_deep).
//
// products is a PARTITIONED table (by country_code). A previous version of this DDL
// used ALTER TABLE ADD CONSTRAINT UNIQUE, which creates an ON ONLY index on the parent
// that does NOT propagate to partitions. PostgreSQL's ON CONFLICT cannot use ON ONLY
// indexes on partitioned tables — it requires a proper partitioned unique index.
// This version creates a non-ONLY partitioned index that PostgreSQL auto-propagates
// to all existing and future partitions. Idempotent.
const PRODUCTS_UNIQUE_CONSTRAINT_DDL = `
DO $$
DECLARE
  r record;
BEGIN
  -- Drop any existing ON ONLY parent constraint/index (created by a previous
  -- ALTER TABLE ADD CONSTRAINT UNIQUE). ON ONLY indexes do NOT work with
  -- ON CONFLICT on partitioned tables — PostgreSQL requires a proper
  -- partitioned unique index (without ONLY) so the conflict target exists
  -- on each partition.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'products'::regclass
      AND conname = 'products_sku_source_country_unique'
      AND contype = 'u'
  ) THEN
    ALTER TABLE products DROP CONSTRAINT products_sku_source_country_unique;
    RAISE NOTICE 'Dropped ON ONLY parent constraint products_sku_source_country_unique';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.relkind = 'i'
      AND c.relname = 'products_sku_source_country_unique'
  ) THEN
    EXECUTE 'DROP INDEX public.products_sku_source_country_unique';
    RAISE NOTICE 'Dropped ON ONLY parent index products_sku_source_country_unique';
  END IF;

  -- Drop per-partition standalone unique indexes on (sku, source, country_code).
  -- These were created by earlier migration attempts and conflict with the
  -- partitioned index we are about to create. Only drop indexes NOT backing
  -- a constraint (safety: never drop PK or FK-backed indexes).
  FOR r IN
    SELECT ic.relname AS idxname
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
     WHERE i.indrelid IN (
             SELECT inhrelid FROM pg_inherits
              WHERE inhparent = 'public.products'::regclass
           )
       AND i.indisunique
       AND pg_get_indexdef(i.indexrelid) LIKE '%btree (sku, source, country_code)'
       AND NOT EXISTS (
             SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid
           )
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.idxname);
    RAISE NOTICE 'Dropped per-partition duplicate index %', r.idxname;
  END LOOP;

  -- Create a proper PARTITIONED unique index (no ONLY).
  -- PostgreSQL auto-propagates this to all existing and future partitions,
  -- enabling ON CONFLICT (sku, source, country_code) on the partitioned table.
  CREATE UNIQUE INDEX IF NOT EXISTS products_sku_source_country_unique
    ON products (sku, source, country_code);
  RAISE NOTICE 'Partitioned unique index products_sku_source_country_unique created/verified';
END
$$;
`;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteQualifiedIdentifier(qualifiedIdentifier: string): string {
  return qualifiedIdentifier.split('.').map(quoteIdentifier).join('.');
}

async function ensureStrictDealsIndexes() {
  const partitions = await db.query(
    `SELECT c.oid::regclass::text AS table_name
       FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'public.products'::regclass
      ORDER BY c.oid::regclass::text`
  );
  const targetTables = partitions.rows.length > 0
    ? partitions.rows.map((row: { table_name: string }) => row.table_name)
    : ['public.products'];

  for (const tableName of targetTables) {
    const safeSuffix = tableName.replace(/^public\./, '').replace(/[^a-zA-Z0-9_]/g, '_');
    const quotedTableName = quoteQualifiedIdentifier(tableName);
    const expectedIndexes = [
      {
        name: `idx_buy64112_deals_country_${safeSuffix}`,
        tableName,
        createSql: `
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_buy64112_deals_country_${safeSuffix}
            ON ${quotedTableName} (currency, country_code, discount_pct DESC)
            WHERE discount_pct IS NOT NULL AND price > 0 AND is_active = true
              AND country_code IS NOT NULL
        `,
      },
      {
        name: `idx_buy64112_deals_region_${safeSuffix}`,
        tableName,
        createSql: `
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_buy64112_deals_region_${safeSuffix}
            ON ${quotedTableName} (currency, region, discount_pct DESC)
            WHERE discount_pct IS NOT NULL AND price > 0 AND is_active = true
              AND region IS NOT NULL
        `,
      },
    ];

    for (const expectedIndex of expectedIndexes) {
      try {
        const client = await db.connect();
        try {
          await client.query('SET statement_timeout = 1800000');
          await client.query('SET lock_timeout = 60000');
          await client.query(expectedIndex.createSql);
          console.log(`[migration] ${expectedIndex.name} verified for ${expectedIndex.tableName}.`);
        } finally {
          client.release();
        }
      } catch (err: any) {
        console.warn(`[migration] ${expectedIndex.name} strict index verify failed (non-fatal): ${err.message?.slice(0, 200)}`);
      }
    }
  }
}

export async function runMigrations() {
  console.log('Running migrations...');

  // BUY-60824: run tiny redirect-critical schema patches before the monolithic
  // migration block. The full block can time out while building product indexes;
  // this column must still be present so /r/:affiliateSlug/:productId can read
  // affiliate_url instead of falling back to stale/empty destination_url.
  try {
    await db.query('SET lock_timeout = 5000');
    await db.query('ALTER TABLE affiliate_links ADD COLUMN IF NOT EXISTS affiliate_url TEXT');
    console.log('[migration] affiliate_links.affiliate_url verified (BUY-60824).');
  } catch (err: any) {
    console.warn(`[migration] affiliate_url preflight failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // BUY-67318: ensure outbound-link health schema independently of the monolithic
  // migration block. The full block is best-effort and can fail before reaching
  // affiliate_clicks/url_probe_log on live DBs; redirect gating must still have
  // the columns it reads and the probe worker must still have its append-only log.
  try {
    await db.query('SET lock_timeout = 5000');
    await db.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS url_status TEXT NOT NULL DEFAULT 'ok';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS url_last_checked_at TIMESTAMPTZ;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS url_status_reason TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS url_dead_at TIMESTAMPTZ;
      ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS was_dead_at_click BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS user_agent TEXT;
      ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS agent_framework TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS ip_hash TEXT;
      ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS referrer TEXT;
      ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS source_page TEXT;
      ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS api_key_id TEXT;
      ALTER TABLE affiliate_clicks ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;
      CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_truth
        ON affiliate_clicks(clicked_at, agent_framework, is_internal);
      CREATE TABLE IF NOT EXISTS url_probe_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id TEXT NOT NULL,
        merchant_id TEXT,
        url TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        http_status INTEGER,
        checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        latency_ms INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_url_probe_log_product_checked_at ON url_probe_log(product_id, checked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_url_probe_log_status_checked_at ON url_probe_log(status, checked_at DESC);
      GRANT INSERT, SELECT ON url_probe_log TO PUBLIC;
      CREATE INDEX IF NOT EXISTS idx_products_url_probe_due ON products(url_last_checked_at) WHERE is_active = true AND url IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_products_url_status ON products(url_status);
    `);
    console.log('[migration] outbound-link health schema ensured (BUY-67318).');
  } catch (err: any) {
    console.warn(`[migration] outbound-link health schema preflight failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // Run full migration block as-is (best-effort, may fail on extensions or
  // products columns if those tables/perms don't exist yet).
  try {
    await db.query(MIGRATION);
    console.log('Full migration completed.');
  } catch (err: any) {
    console.warn(`[migration] Full migration block failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // BUY-56217: ensure products has the UNIQUE (sku, source, country_code) constraint
  // required by POST /v1/ingest's ON CONFLICT clause. Run as a SEPARATE try/catch so
  // that a failure in the monolithic MIGRATION block (extension install, index
  // creation, etc.) cannot silently prevent this constraint from being created. On
  // production this was the root cause of `database_schema_mismatch` 503s: the
  // constraint DO block lived inside the MIGRATION string, so when MIGRATION failed
  // before reaching it (and the catch only logged), the constraint was never
  // created and ingest returned schema_mismatch for every woocommerce_deep batch.
  // Idempotent; drops any stale ON ONLY constraint/index and creates a proper
  // partitioned unique index that works with ON CONFLICT on the partitioned table.
  try {
    // 2026-07-15: skip the 3-col build when the valid 2-col unique already exists.
    // products is NOT partitioned (relkind='r'); the (sku,source) unique index is
    // valid and the ingest schema guard (BUY-56338) discovers + uses it as the
    // ON CONFLICT target. The 3-col CONCURRENT build can never finish on the live
    // archive (ops watchdogs cancel >30min CIC by design), so attempting it here
    // just failed with a lock timeout on every deploy.
    const twoCol = await db.query(
      `SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE i.indrelid = 'products'::regclass AND c.relname = 'products_sku_source_unique'
          AND i.indisunique AND i.indisvalid`);
    if (twoCol.rows.length > 0) {
      console.log('[migration] products (sku, source) UNIQUE index valid — skipping 3-col build (BUY-56217 superseded 2026-07-15).');
    } else {
    console.log('[migration] Ensuring products partitioned UNIQUE index (sku, source, country_code) (BUY-56217)...');
    const uqClient = await db.connect();
    try {
      // 5-min statement timeout: with 14M+ rows the index build can take a while.
      // 60s lock timeout: do not block live ingest traffic.
      await uqClient.query('SET statement_timeout = 300000');
      await uqClient.query('SET lock_timeout = 60000');
      await uqClient.query(PRODUCTS_UNIQUE_CONSTRAINT_DDL);
      console.log('[migration] products partitioned UNIQUE index verified (BUY-56217).');
    } finally {
      uqClient.release();
    }
    // Verify the unique index is now in place — emit a clear error if not.
    // We check pg_index (not pg_constraint) because we CREATE UNIQUE INDEX
    // (not ALTER TABLE ADD CONSTRAINT) to get a proper partitioned index.
    const uqVerify = await db.query(
      `SELECT 1 FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
       WHERE i.indrelid = 'products'::regclass
         AND c.relname = 'products_sku_source_country_unique'
         AND i.indisunique AND i.indisvalid`
    );
    if (uqVerify.rowCount === 0) {
      throw new Error('Unique index products_sku_source_country_unique not found after CREATE — manual intervention required');
    }
    } // end else (3-col build only when 2-col unique absent)
  } catch (err: any) {
    console.error(`[migration] FATAL: products UNIQUE index failed (BUY-56217): ${err.message?.slice(0, 200)}`);
    // Re-throw so the failure is visible in startup logs; the schema guard
    // would otherwise silently fail every ingest for the lifetime of the deploy.
    throw err;
  }

  // BUY-45553: Prune redundant DUPLICATE indexes on the products partitioned table.
  //
  // Over time the products table accumulated two parallel sets of byte-identical
  // indexes (e.g. a code-owned `idx_products_*` set plus an out-of-band
  // `idx_products_partitioned_*` set, and standalone per-partition copies like
  // `products_us_active_fts`). Every INSERT/UPDATE had to maintain BOTH copies of
  // each index — and the products table carries ~13 GIN indexes per partition on a
  // multi-GB heap, so the duplicate GIN trees dominate write cost. Under real
  // woocommerce_deep batches this pushed `POST /v1/ingest` past the 30s budget,
  // landing 0 rows/hr on the WC REST deep lane.
  //
  // This sweep is generic (matches duplicates by normalized definition, not by name)
  // so it self-corrects whatever auto-generated names exist in a given environment.
  // It is SAFE: for each group of identical indexes it keeps exactly one and drops
  // the rest, so every query still has an index to use. It never touches indexes that
  // back a constraint (PK/UNIQUE). Bounded lock_timeout prevents blocking live writes;
  // idempotent (no-op once duplicates are gone).
  const DEDUP_DUPLICATE_PRODUCT_INDEXES = `
    DO $dedup$
    DECLARE
      r record;
    BEGIN
      -- 1) Duplicate PARTITIONED parent indexes on public.products.
      --    Dropping a parent partitioned index cascades to every partition.
      FOR r IN
        WITH parent_idx AS (
          SELECT c.relname AS idxname,
                 regexp_replace(pg_get_indexdef(i.indexrelid),
                                '^CREATE (UNIQUE )?INDEX \\S+ ON', 'ON') AS norm
          FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
          WHERE i.indrelid = 'public.products'::regclass
            AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid)
        ), ranked AS (
          SELECT idxname,
                 row_number() OVER (
                   PARTITION BY norm
                   -- keep the most "canonical" name: prefer non-_partitioned_, non
                   -- numeric-suffixed, then lexical order; drop the rest.
                   ORDER BY (idxname ~ '_partitioned_')::int,
                            (idxname ~ '_idx[0-9]+$')::int,
                            idxname
                 ) AS rn
          FROM parent_idx
        )
        SELECT idxname FROM ranked WHERE rn > 1
      LOOP
        EXECUTE format('DROP INDEX IF EXISTS public.%I', r.idxname);
        RAISE NOTICE 'BUY-45553: dropped duplicate partitioned product index %', r.idxname;
      END LOOP;

      -- 2) Standalone per-partition duplicate indexes NOT attached to a parent
      --    partitioned index (these can't be reached via the parent in step 1).
      --    Compare against all indexes on the same partition; only ever drop the
      --    detached copy, keeping an attached/canonical one.
      FOR r IN
        WITH part_idx AS (
          SELECT i.indrelid,
                 ic.relname AS idxname,
                 EXISTS (SELECT 1 FROM pg_inherits pii WHERE pii.inhrelid = i.indexrelid) AS attached,
                 regexp_replace(pg_get_indexdef(i.indexrelid),
                                '^CREATE (UNIQUE )?INDEX \\S+ ON', 'ON') AS norm
          FROM pg_index i
          JOIN pg_class ic ON ic.oid = i.indexrelid
          WHERE i.indrelid IN (SELECT inhrelid FROM pg_inherits
                               WHERE inhparent = 'public.products'::regclass)
            AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid)
        ), ranked AS (
          SELECT idxname, attached,
                 row_number() OVER (
                   PARTITION BY indrelid, norm
                   ORDER BY attached DESC,                  -- keep attached/canonical copy
                            (idxname ~ '_idx[0-9]+$')::int,
                            idxname
                 ) AS rn
          FROM part_idx
        )
        SELECT idxname FROM ranked WHERE rn > 1 AND NOT attached
      LOOP
        EXECUTE format('DROP INDEX IF EXISTS public.%I', r.idxname);
        RAISE NOTICE 'BUY-45553: dropped duplicate partition product index %', r.idxname;
      END LOOP;
    END $dedup$;
  `;
  try {
    await db.query("SET statement_timeout = 60000");
    await db.query("SET lock_timeout = 4000");
    await db.query(DEDUP_DUPLICATE_PRODUCT_INDEXES);
    console.log('[migration] Redundant duplicate product indexes pruned (BUY-45553).');
  } catch (err: any) {
    console.warn(`[migration] Index dedup step failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // BUY-64112: repair stale deal indexes before the legacy generated-column gate
  // below. Production has a populated plain discount_pct column; even if converting
  // it to GENERATED is deferred/fails, strict get_deals must still use the column
  // index path instead of seq-scanning the live products table.
  await ensureStrictDealsIndexes();

  // BUY-22324: discount_pct GENERATED STORED column — must detect and fix a plain
  // (non-generated) column left by a prior migration failure.
  // Uses guarded CASE with regex to prevent dirty original_price from failing inserts.
  const DISCOUNT_PCT_DDL = `
    DO $$
    DECLARE
      _is_generated text;
    BEGIN
      SELECT c.is_generated INTO _is_generated
        FROM information_schema.columns c
       WHERE c.table_name = 'products' AND c.column_name = 'discount_pct';

      IF _is_generated IS NULL THEN
        ALTER TABLE products
          ADD COLUMN discount_pct numeric
          GENERATED ALWAYS AS (
            CASE
              WHEN (metadata->>'original_price') ~ '^[0-9]+(\\.[0-9]+)?$'
               AND (metadata->>'original_price')::numeric > 0
              THEN ROUND((1 - price / (metadata->>'original_price')::numeric) * 100)
            END
          ) STORED;
      ELSIF _is_generated = 'NEVER' THEN
        ALTER TABLE products DROP COLUMN discount_pct;
        ALTER TABLE products
          ADD COLUMN discount_pct numeric
          GENERATED ALWAYS AS (
            CASE
              WHEN (metadata->>'original_price') ~ '^[0-9]+(\\.[0-9]+)?$'
               AND (metadata->>'original_price')::numeric > 0
              THEN ROUND((1 - price / (metadata->>'original_price')::numeric) * 100)
            END
          ) STORED;
      END IF;
    END$$;

    CREATE INDEX IF NOT EXISTS idx_products_deals_discount_pct
      ON products (currency, discount_pct DESC)
      WHERE discount_pct IS NOT NULL AND price > 0;
  `;

  try {
    console.log('[migration] Ensuring discount_pct is a GENERATED STORED column (extended timeout for 14M row table)...');
    const client = await db.connect();
    try {
      await client.query('SET statement_timeout = 360000');
      await client.query(DISCOUNT_PCT_DDL);
      console.log('[migration] discount_pct GENERATED column and index verified.');
    } finally {
      client.release();
    }

    const verify = await db.query(
      `SELECT is_generated FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'discount_pct'`
    );
    if (verify.rows.length === 0 || verify.rows[0].is_generated !== 'ALWAYS') {
      throw new Error(`discount_pct column is missing or not GENERATED (is_generated=${verify.rows[0]?.is_generated})`);
    }
    const countCheck = await db.query(`SELECT count(*) AS cnt FROM products WHERE discount_pct IS NOT NULL`);
    console.log(`[migration] discount_pct non-null rows: ${countCheck.rows[0].cnt}`);
  } catch (err: any) {
    throw new Error(`[migration] FATAL: discount_pct GENERATED column failed: ${err.message}`);
  }

  // BUY-30968: Ensure api_keys columns added in BUY-29220/BUY-30073 are present even
  // when the main MIGRATION block fails before reaching those ALTER TABLE statements.
  try {
    await db.query(`
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_prefix       TEXT;
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS label            TEXT;
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS fingerprint_hash TEXT;
    `);
    console.log('[migration] api_keys key_prefix/label/fingerprint_hash columns ensured.');
  } catch (err: any) {
    console.warn(`[migration] api_keys column ensure failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // BUY-31040: Prevent future google-shopping source rows (owner: postgres role via API).
  // IF NOT EXISTS → idempotent; NOT VALID → skips full-table scan (0 rows exist).
  try {
    await db.query(`
      ALTER TABLE products
        ADD CONSTRAINT IF NOT EXISTS products_source_no_legacy_google_shopping
        CHECK (source <> 'google-shopping'::text) NOT VALID;
    `);
    console.log('[migration] products_source_no_legacy_google_shopping constraint ensured (BUY-31040).');
  } catch (err: any) {
    console.warn(`[migration] products_source_no_legacy_google_shopping constraint failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // BUY-62708 / BUY-74173: ensure query_log telemetry columns exist independently
  // of the MIGRATION block (live DBs created before these columns landed never run
  // standalone /migrations/*.sql files).
  try {
    await db.query(`
      ALTER TABLE query_log ADD COLUMN IF NOT EXISTS cache_hit boolean;
      ALTER TABLE query_log ADD COLUMN IF NOT EXISTS returned_product_ids text[];
    `);
    console.log('[migration] query_log telemetry columns ensured (BUY-62708/BUY-74173).');
  } catch (err: any) {
    console.warn(`[migration] query_log telemetry column preflight failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // BUY-72774: ensure api_keys columns for pending-verify tier (verify=false registration path)
  try {
    await db.query(`
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS weekly_request_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS weekly_reset_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days');
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS consecutive_outbound_days INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_outbound_date DATE;
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS failed_request_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS registration_ip TEXT;
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS keys_from_same_ip_24h INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_api_keys_pending_verify ON api_keys(tier, created_at) WHERE tier = 'pending_verify';
    `);
    console.log('[migration] pending-verify columns ensured (BUY-72774).');
  } catch (err: any) {
    console.warn(`[migration] pending-verify column ensure failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // Separately ensure merchants tables exist — not blocked by failures above.
  try {
    await db.query(MERCHANTS_MIGRATION);
    console.log('Merchants migration completed.');
  } catch (err: any) {
    console.error(`[migration] Merchants table creation failed: ${err.message?.slice(0, 200)}`);
  }

  // BUY-52288: Ensure the merchants table has all 10 columns that the route
  // handlers (POST /upsert, GET /, GET /:id) SELECT/INSERT. The original
  // CREATE TABLE IF NOT EXISTS in MERCHANTS_MIGRATION only applies to a brand-
  // new table — the live DB was created earlier with just (id, name, source,
  // country, created_at, onboarding_stage), which made every /v1/merchants
  // call 500 and emptied sitemap-products.xml. All idempotent. Also backfills
  // updated_at on pre-existing rows that were created with no updated_at.
  try {
    await db.query(`
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS domain            TEXT;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS contact_email     TEXT;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS contact_phone     TEXT;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS scraping_priority TEXT     DEFAULT 'medium';
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS is_active         BOOLEAN  NOT NULL DEFAULT true;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS first_indexed_at  TIMESTAMPTZ;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS products_count    INTEGER;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS last_scraped_at   TIMESTAMPTZ;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS scrape_error      TEXT;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();
      UPDATE merchants SET updated_at = created_at WHERE updated_at IS NULL;
    `);
    console.log('[migration] merchants column set ensured (BUY-52288).');
  } catch (err: any) {
    console.warn(`[migration] merchants column ensure failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // BUY-74732: Add slug + scraped_via columns to merchants for the
  // <MerchantBadge> verified-mark logic. Both nullable, idempotent.
  // - slug: URL-safe kebab-case identifier (e.g. "tangs-sg", "decathlon-sg")
  // - scraped_via: how the catalog sourced this merchant (first_party/affiliate/aggregator)
  try {
    await db.query(`
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS slug            TEXT;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS scraped_via    TEXT;
    `);
    console.log('[migration] merchants slug + scraped_via ensured (BUY-74732).');
  } catch (err: any) {
    console.warn(`[migration] merchants slug/scraped_via ensure failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // BUY-74732: Add scraped_via column to products for per-row provenance.
  try {
    await db.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS scraped_via TEXT;
    `);
    console.log('[migration] products scraped_via ensured (BUY-74732).');
  } catch (err: any) {
    console.warn(`[migration] products scraped_via ensure failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // BUY-24284: Restore the search_vector trigger that was dropped in a prior migration.
  // Without it, every new product insert leaves search_vector NULL and FTS returns 0 results.
  try {
    const svClient = await db.connect();
    try {
      await svClient.query(`
        CREATE OR REPLACE FUNCTION products_search_vector_update()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.search_vector := to_tsvector('english',
            COALESCE(NEW.title, '') || ' ' ||
            COALESCE(NEW.brand, '') || ' ' ||
            COALESCE(array_to_string(NEW.category_path, ' '), '')
          );
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS products_search_vector_trig ON products;
        CREATE TRIGGER products_search_vector_trig
          BEFORE INSERT OR UPDATE OF title, brand, category_path
          ON products
          FOR EACH ROW EXECUTE FUNCTION products_search_vector_update();
      `);
      console.log('[migration] search_vector trigger restored (BUY-24284).');
    } finally {
      svClient.release();
    }
  } catch (err: any) {
    console.warn(`[migration] search_vector trigger creation failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // Backfill NULL search_vector rows — same 6-min timeout pattern as discount_pct.
  // Non-fatal: the trigger above covers all new writes; this fixes the existing corpus.
  try {
    const backfillClient = await db.connect();
    try {
      await backfillClient.query('SET statement_timeout = 360000'); // 6 min
      const { rows: countRows } = await backfillClient.query(
        `SELECT COUNT(*) AS cnt FROM products WHERE search_vector IS NULL`
      );
      const nullCount = parseInt(countRows[0].cnt, 10);
      if (nullCount > 0) {
        console.log(`[migration] Backfilling search_vector for ${nullCount} NULL rows (BUY-24284)...`);
        await backfillClient.query(
          `UPDATE products
           SET search_vector = to_tsvector('english',
             COALESCE(title, '') || ' ' ||
             COALESCE(brand, '') || ' ' ||
             COALESCE(array_to_string(category_path, ' '), '')
           )
           WHERE search_vector IS NULL`
        );
        console.log('[migration] search_vector backfill complete.');
      } else {
        console.log('[migration] search_vector already populated for all rows, skipping backfill.');
      }
    } finally {
      backfillClient.release();
    }
  } catch (err: any) {
    console.warn(`[migration] search_vector backfill timed out or failed (non-fatal, trigger covers new rows): ${err.message?.slice(0, 200)}`);
  }

  // BUY-32082: P95 monitoring schema — stores latency samples and alert history for
  // all 5 markets (SG, US, MY, VN, TH). The p95_latency table is written by the
  // monitoring job every 5 minutes; alert_history tracks threshold breaches.
  try {
    await db.query(`
      CREATE SCHEMA IF NOT EXISTS monitoring;

      CREATE TABLE IF NOT EXISTS monitoring.p95_latency (
        id            BIGSERIAL   PRIMARY KEY,
        market        VARCHAR(2)  NOT NULL CHECK (market IN ('sg','us','my','vn','th')),
        endpoint      TEXT        NOT NULL,
        p95_ms        INTEGER     NOT NULL,
        sample_size   INTEGER     NOT NULL,
        window_start  TIMESTAMPTZ NOT NULL,
        window_end    TIMESTAMPTZ NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS monitoring.idx_p95_latency_market_time
        ON monitoring.p95_latency (market, window_end DESC);
      CREATE INDEX IF NOT EXISTS monitoring.idx_p95_latency_endpoint
        ON monitoring.p95_latency (endpoint, window_end DESC);

      CREATE TABLE IF NOT EXISTS monitoring.alert_history (
        id                BIGSERIAL   PRIMARY KEY,
        market            VARCHAR(2)  NOT NULL CHECK (market IN ('sg','us','my','vn','th')),
        p95_ms            INTEGER     NOT NULL,
        threshold_ms      INTEGER     NOT NULL DEFAULT 300,
        triggered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        acknowledged_at   TIMESTAMPTZ,
        acknowledged_by   TEXT,
        resolution_notes  TEXT
      );

      CREATE INDEX IF NOT EXISTS monitoring.idx_alert_history_market_time
        ON monitoring.alert_history (market, triggered_at DESC);

      -- Cleanup function: delete rows older than retention_days in both tables.
      -- Safe to call periodically; used by the /api/monitoring/p95/cleanup endpoint.
      CREATE OR REPLACE FUNCTION monitoring.cleanup_old_p95_data(retention_days INTEGER DEFAULT 7)
        RETURNS INTEGER
        LANGUAGE plpgsql AS $$
      DECLARE
        deleted INTEGER;
      BEGIN
        DELETE FROM monitoring.p95_latency
          WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
        GET DIAGNOSTICS deleted = ROW_COUNT;

        DELETE FROM monitoring.alert_history
          WHERE triggered_at < NOW() - (retention_days || ' days')::INTERVAL;
        RETURN deleted;
      END;
      $$;
    `);
    console.log('[migration] P95 monitoring schema ensured (BUY-32082).');
  } catch (err: any) {
    console.warn(`[migration] P95 monitoring schema failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // BUY-72556: Server-side v2 adoption telemetry. Atlas's daily 23:56Z
  // aggregator (BUY-72550) reads this table + the v2_adoption_daily view to
  // emit data/v2-adoption-server-side/YYYY-MM-DD.csv. The api process
  // writes one row per JSON-RPC tools/call whose params.name ends with `_v2`
  // (see api/src/monitoring/v2RequestLog.ts). Idempotent — IF NOT EXISTS
  // guards make re-runs cheap.
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS monitoring.mcp_v2_request_log (
        id                  BIGSERIAL    PRIMARY KEY,
        request_id          TEXT         NOT NULL,
        tool_name           TEXT         NOT NULL,
        deliver_to_present  BOOLEAN      NOT NULL,
        country_code        TEXT             NULL,
        gate_passed         BOOLEAN      NOT NULL,
        outcome             TEXT         NOT NULL,
        api_key_hash        TEXT             NULL,
        received_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_mcp_v2_request_log_received_at
        ON monitoring.mcp_v2_request_log (received_at);
      CREATE INDEX IF NOT EXISTS idx_mcp_v2_request_log_received_tool
        ON monitoring.mcp_v2_request_log (received_at, tool_name);
      CREATE INDEX IF NOT EXISTS idx_mcp_v2_request_log_received_outcome
        ON monitoring.mcp_v2_request_log (received_at, outcome);

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
    `);
    console.log('[migration] mcp_v2_request_log + v2_adoption_daily ensured (BUY-72556).');
  } catch (err: any) {
    console.warn(`[migration] mcp_v2_request_log ensure failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  console.log('Migrations complete.');
}

async function migrate() {
  await runMigrations();
  await db.end();
  redis.disconnect();
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
