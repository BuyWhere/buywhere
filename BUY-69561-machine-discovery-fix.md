# BUY-69561 Fix Evidence — Machine-Discovery 404 Responses

**Date:** 2026-08-14  
**Issue:** Machine-discovery endpoints return inconsistent 404 responses — HTML shells vs concise machine text

---

## Changes Made

### 1. New route files added

| Route | File | Response |
|---|---|---|
| `/humans.txt` | `src/app/humans.txt/route.ts` | 404 text/plain ~70B |
| `/opensearch.xml` | `src/app/opensearch.xml/route.ts` | 404 application/xml ~70B |
| `/.well-known/assetlinks.json` | `src/app/.well-known/assetlinks.json/route.ts` | 404 application/json ~80B |

### 2. Middleware updates

Added 3 new entries to `OPTIONAL_METADATA_MISSES` in `src/middleware.ts` (lines ~168-183):
- `/humans.txt` → 404 text/plain
- `/opensearch.xml` → 404 application/xml  
- `/.well-known/assetlinks.json` → 404 application/json

### 3. Shared helper improvements

Added `unsupportedJsonMetadataRoute()` to `src/lib/optional-metadata-routes.ts` for JSON 404 responses.

### Already correct (from prior work)
- `/security.txt` → 404 text/plain ✅
- `/.well-known/security.txt` → 404 text/plain ✅
- `/.well-known/apple-app-site-association` → 404 JSON ✅
- `/.well-known/oauth-authorization-server` → 404 text/plain ✅
- `/.well-known/openid-configuration` → 404 text/plain ✅
- `/browserconfig.xml` → **200** application/xml (valid config published) ✅

---

## Verification

```bash
# Before fix (expected HTML 31KB shells):
curl -sI https://buywhere.ai/humans.txt | head -5
curl -sI https://buywhere.ai/opensearch.xml | head -5
curl -sI https://buywhere.ai/.well-known/assetlinks.json | head -5

# After fix (expected <200B machine responses):
# - humans.txt: 404 text/plain ~70B
# - opensearch.xml: 404 application/xml ~70B  
# - assetlinks.json: 404 application/json ~80B
```

---

## Remaining (Not Fixed / Known)

| Endpoint | Status | Notes |
|---|---|---|
| `/browserconfig.xml` | Returns 200 with valid XML config | **Not a bug** — serves real config, not a 404 |

The issue description mentioned mixed signals (404 + XML body), but the current code returns a 200 with a valid `<browserconfig>` — this is correct behavior when a config is intentionally published. No change needed.
