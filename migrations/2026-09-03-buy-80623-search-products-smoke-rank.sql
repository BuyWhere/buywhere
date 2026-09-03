-- BUY-80623: tiny top-K FTS snapshot so SEA smoke queries survive a cold 78GB heap.
-- Catalog DB only (sakura). Never roundhouse. application_name=ops-ddl.
SET application_name = 'ops-ddl';
CREATE TABLE IF NOT EXISTS search_products_smoke_rank (
  query text NOT NULL,
  country_code text NOT NULL,
  rank int NOT NULL,
  product_id bigint NOT NULL,
  sku text,
  source text,
  merchant_id text,
  title text,
  brand text,
  category text,
  price numeric,
  currency text,
  in_stock boolean,
  image_url text,
  url text,
  region text,
  updated_at timestamptz,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (query, country_code, rank)
);
CREATE INDEX IF NOT EXISTS idx_smoke_rank_lookup
  ON search_products_smoke_rank (country_code, query);
COMMENT ON TABLE search_products_smoke_rank IS
  'BUY-80623: top-K FTS snapshot for shirt/phone/nike/laptop × SG/MY/TH/VN/ID/PH/US. MCP/REST short-circuit; hourly drain refresh.';
