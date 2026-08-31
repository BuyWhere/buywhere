# BUY-76554 Hex Diagnostics — 2026-08-28T16:57Z

Read-only diagnostics against BuyWhere catalog DB only. DSN guard verified the target as sakura/postgres.railway.internal and refused any roundhouse/control-plane path.

## Current Findings

- Current `pg_settings` differ from issue opener: `shared_buffers` is now 12GB, `effective_cache_size` 20GB, `work_mem` 96MB, `max_parallel_workers_per_gather=0`.
- `pg_stat_database` still shows severe I/O pressure: `blks_read=4,435,513,160`, `blks_hit=13,805,231,992`, `cache_hit_pct=75.68%`, temp spill total `165GB`, `deadlocks=6`.
- Table estimates: `products` ~364.0M live / 117.5K dead; `search_products` ~97.2M live / 20.5K dead.
- Search index hot spots: `idx_sp_fts` is 5.6GB with only 357 scans but 99.6M tuples read; `idx_sp_cc_price` is 6.7GB with 729.4M tuples read; `idx_sp_trgm` is 12GB.
- Live authenticated API smoke is currently green for SG intents: `iphone singapore`, `macbook singapore`, and `air purifier singapore` each returned 6 rows in 201–408ms.
- Direct uncached FTS remains risky: `air purifier singapore` with `ORDER BY ts_rank(...) LIMIT 6` took 5.35s with 5.31s shared read I/O for only 138 FTS hits; `iphone singapore` variants hit a 9s `statement_timeout`.

## Interpretation

Customer-facing search is currently protected/cached/fast, but the root risk remains cold random I/O from `search_products` FTS/ranking paths. This supports BUY-76554 as an I/O saturation and ranking-plan issue, not an auth or no-match issue.

## Recommendation

No infrastructure or DB setting changes were made. Engineering-safe next step is to keep avoiding uncached `ts_rank` paths for hot SG intent traffic and add/narrow pre-ranked country/query candidate tables. DB-level changes should remain with Oracle/Richmond because infrastructure mutation is out of scope for Hex.

## Paperclip Write Failure

Attempted to comment and set final status through `PATCH /api/issues/ccae14de-2279-44b8-860b-450de4d318ab` and `POST /api/issues/ccae14de-2279-44b8-860b-450de4d318ab/comments` with `X-Paperclip-Run-Id: 946d5b98-376e-4d0c-ba09-e6ff1da21375`; both returned `cross_issue_influence_run_context_required`. Per heartbeat contract, stopped retrying after repeated same control-plane write failure.
