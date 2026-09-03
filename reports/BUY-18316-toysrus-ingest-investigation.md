# BUY-18316 toysrus.com 100-row ingest investigation

Date: 2026-05-16 UTC

## Summary

The `BUY-18300` recovery artifact already narrowed the problem to a single final ingest batch for `toysrus.com`:

- 2,500 products fetched
- 2,400 products ingested
- final 100-row batch failed
- recorded failure shape: `status=failed` with no error body

That failure shape does not match the normal handled validation/database paths in `api/src/routes/ingest.ts`, which return JSON with either `errors[]` or `http_code`. It does match an unhandled async rejection in the Express 4 route, where the client connection can close without a structured body.

## Evidence

1. `reports/BUY-18300-completion.md` explicitly records: `toysrus.com` fetched 2,500 and ingested 2,400, with the final 100-row batch failing and no error body.
2. The batch scraper treats handled HTTP failures as `{status:"failed", http_code, error}` and handled app failures as `{status:"failed", errors:[...]}`.
3. Before this heartbeat, `api/src/routes/ingest.ts` used an `async` Express 4 handler without a wrapper, unlike `api/src/routes/products.ts`, which already documents that Express 4 does not catch async rejections.
4. The ingest route had several awaited database calls outside its local bulk-upsert `try/catch`, including:
   - create ingestion run
   - select existing SKUs
   - select final product ids
5. If one of those awaits exhausted retry budget or rejected for another DB/runtime reason, the request could terminate without the scraper receiving JSON, which matches the empty-body symptom from the recovery run.
6. I fetched `toysrus.com` pages 10 and 11 directly. Both still return 250 products today, so the tail batch size is consistent with the original report. I did not find obvious outlier lengths or malformed handles in that tail slice.

## Most likely cause

Most likely: a transient API-side failure in one of the uncaught awaited calls inside `/v1/ingest/products`, probably during or immediately after the final batch write path, surfaced to the client as a dropped/empty response because the route was not wrapped for async error handling.

I cannot prove the exact thrown exception from the historical run because the prior scraper report preserved neither the exception type nor a fallback `repr(e)`, and this workspace does not include the remote API runtime logs for that run.

## Durable changes made

1. Hardened `api/src/routes/ingest.ts` with an `asyncHandler` wrapper so future uncaught async failures return a JSON 500 envelope instead of closing the connection silently.
2. Left the existing retry behavior in place, but ensured exhausted retries now surface as structured ingest errors.
3. Updated `scripts/batch_shopify_scraper.py` to preserve exception class/name when `str(e)` is empty, so future reports cannot collapse this class of failure into a blank error.

## Verification

- `python3 -m py_compile scripts/batch_shopify_scraper.py` passed.
- `npm run build` in `api/` did not complete because the repo already has pre-existing TypeScript environment issues unrelated to this change (`@types/express`, `@types/cors`, and widespread implicit-any errors in multiple files).
