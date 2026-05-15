# BUY-17646 Verification Note (2026-05-15)

## Goal
Resume Rotation 8 verification for MY & TH market data after BUY-14375 key fix.

## What was executed
- Confirmed MCP schema discovery endpoint is live:
  - `POST /mcp` with `method=tools/list` returns tools and schemas including `country_code` enums with `MY` and `TH`.
  - `POST /mcp` with `method=initialize` returns server info.
- Confirmed MCP tool calls still require Bearer auth (as expected): unauthenticated `tools/call` returns `MISSING_API_KEY`.
- Registered a temp key via `POST /v1/auth/register` to avoid shared-key dependency.
  - Received key: `bw_18eb068efb8145f98d61814d266e6138` (unverified tier).
- Auth checks succeed on protected routes (example: `GET /v1/merchants?limit=1` returned 200 with data).

## Blocking behavior observed
- Authenticated search/deals calls are hanging and return no bytes before timeout:
  - `POST https://mcp.buywhere.ai/mcp` `tools/call` with `search_products` (country_code=MY/TH, limit=5)
  - `GET https://api.buywhere.ai/v1/products/search?...` (including redirects from `/v1/search`)
  - `GET https://api.buywhere.ai/v1/products/deals?limit=5`
  - `GET https://api.buywhere.ai/v1/categories?limit=5`
- Each timed out with 20s client timeout (`0 bytes received`) while TLS/HTTP request was accepted.
- Base health endpoints remained healthy:
  - `GET /health` -> 200
  - `GET /health/redis` -> 200 and `redis=PONG`

## Implication
- I could not complete MY/TH data payload verification because the production data query path is currently non-responsive for authenticated search/deals routes.

## Suggested next step
- Unblock path for this issue by escalating to DB/API platform runtime owners for investigation of slow/stalled `/v1/products/*` queries (including MCP `tools/call` read path).
