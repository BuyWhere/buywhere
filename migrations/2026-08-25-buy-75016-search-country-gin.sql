-- BUY-75016: Composite GIN index for search_vector + country_code.
-- The catalog_search stage for SG/MY/TH was timing out because the planner had to
-- BitmapAnd the large search_vector GIN posting list with a btree country scan.
-- This index bounds the scan to rows matching both the FTS lexeme and country.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_search_country
  ON public.products
  USING gin (search_vector, country_code);
