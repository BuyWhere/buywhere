-- BUY-62708: Search cache observability — add cache_hit column to query_log
-- Nullable, no backfill: existing rows remain NULL (unknown).
-- Populated only for requests that flow through queryLogMiddleware after deploy.

ALTER TABLE query_log ADD COLUMN IF NOT EXISTS cache_hit boolean;
