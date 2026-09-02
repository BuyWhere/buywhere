# BUY-17971 Recovery Notes

## Heartbeat status
- Status reviewed: `blocked` due `database is locked` failure in prior `opencode_local` run (`f3fcc891-5b6f-4497-b38c-65e83154833f`).
- No adapter log attachment is present in-repo for that specific run id, but this error is consistent with retryable lock contention during `POST /v1/ingest/products`.

## Actions taken in this heartbeat
1. Hardened ingestion DB resilience at both TS and transpiled JS paths.
2. Added configurable PostgreSQL lock timeout initialization on each pooled connection (`PG_LOCK_TIMEOUT`, default `2000`).
3. Increased lock retry budget for ingestion DB ops to configurable `INGEST_DB_RETRY_ATTEMPTS` (default `8`) and added bounded backoff with explicit delay logging.

## Files modified
- `api/src/config.ts`
- `api/dist/config.js`
- `api/src/routes/ingest.ts`
- `api/dist/routes/ingest.js`

## Next step
- Re-run the BUY-17971 source flow and watch for any remaining lock contention; if still present, raise the source of parallel writes for this run and reduce concurrent ingestion fan-out.
