-- BUY-69688: Speed up MCP search_products category filters.
-- Supports category ILIKE '%...%' predicates without full table scans.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_category_trgm
ON products USING gin (category gin_trgm_ops);
