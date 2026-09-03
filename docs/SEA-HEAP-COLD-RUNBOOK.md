# SEA heap-cold search (BUY-80623)

MCP `search_products` for `shirt|phone|nike|laptop` × `SG/MY/TH/VN/ID/PH/US` short-circuits to `search_products_smoke_rank` (tiny PK table, hourly cron `search-products-smoke-rank.sh` at :12). Do not CLUSTER the 78GB `search_products` heap for smoke probes; if a pair returns `status=degraded` after Redis flush, run `/home/paperclip/ops-canon/cron/search-products-smoke-rank.sh` and confirm `SELECT query,country_code,count(*) FROM search_products_smoke_rank GROUP BY 1,2`.
