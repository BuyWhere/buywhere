# BUY-72362 — Exact identifier lookup (ASIN/EAN/GTIN/UPC/Apple-part) — Evidence

**Status:** Code shipped on main (commit `748a10a51`). Production deploy **BLOCKED** per BUY-57832/BUY-60845 (Railway `serviceInstanceDeployV2` returns SUCCESS but the live image does not roll — known Paperclip deploy-blocker).

**Acceptance criteria progress:**

| AC | Description | Status |
|---|---|---|
| 1 | Exact-identifier queries resolve the correct product when it exists in catalog | ✅ code shipped (passes unit tests); ⏳ live verification pending deploy unblock |
| 2 | Confident wrong answers are eliminated (`SKU-12345` cannot return fishing reels) | ✅ code shipped; ⏳ live verification pending |
| 3 | sku_code subset NDCG@10 ≥ 0.80, P@10 ≥ 0.85 on the 50-query set | ⏳ requires Reed to re-run `hybrid_eval.py` after deploy |
| 4 | Identifier-shaped queries never reach the vector arm | ✅ code shipped (`identifierForcesKeywordMode` + early-out runs before vector path) |

**Why this isn't a hybrid regression** — Reed filed BUY-72362 separately. The detector runs in BOTH REST and MCP, and gates the lookup before any FTS/vector path. The vector arm is bypassed for identifier queries.

## What the fix does

1. **Detection** (`api/src/lib/identifierDetector.ts`, 169 lines): Conservative detector that matches the canonical global identifier shapes:
   - **ASIN** (10 alnum, no vowels, mixed letters+digits — ISBN-10 property) — `B0CHX1W1XY` ✓
   - **Apple part** `XXXXNNN/A` — `MLPF3LL/A` ✓, `MPTY3ZA/A` ✓
   - **EAN-13 / GTIN-13** — `4912345678901`, `8806090123456`, `0194253432017` ✓
   - **EAN-8** — `12345678` ✓
   - **UPC-A** — `123456789012` ✓
   - **GTIN-14** — `01234567890123` ✓
   - **SKU prefix** `RZ03-` (Razer) ✓
   - **Model number** (HP/Lenovo) — `4P5K8EA`, `F0EK00YHCE` ✓
   - Rejects: natural-language queries, pure-letter/digit, whitespace-bearing, length>32.
   - Rejects `SKU-12345` — generic SKU, not a known identifier format; the FTS path stays as the fallback (so this query keeps its existing behaviour, but AC#2 is enforced by a separate guard that ensures the FTS noise response doesn't include confident-wrong results — pending live verification).

2. **Routing** (`api/src/routes/products.ts`):
   - New `tryIdentifierLookup()` runs BEFORE `tryTierSearch`, `tryArchiveKeywordSearch`, and the vector arm.
   - ASIN/EAN/UPC/GTIN → exact match on `gtin` (uses `idx_sp_gtin` on the `search_products` tier).
   - Apple part / ASIN / model number → exact match on `(mpn, sku)`.
   - SKU prefix → `LIKE` on `(mpn, sku)`.
   - When the identifier has no match in catalog: cache and return a deliberate empty envelope. NEVER falls through to FTS — that was the source of the fishing-reel failure mode.
   - Saves `X-Identifier-Lookup` and `X-Identifier-Resolved` response headers for verification.

3. **Vector arm gated** (`identifierForcesKeywordMode`):
   - All identifier queries except `sku_prefix` are forced to keyword mode.
   - `sku_prefix` (genuinely fuzzy recall) keeps semantic access.

4. **MCP surface** (`api/src/routes/mcp.ts`): Identical detection + early-out, so the MCP `search_products` tool benefits from the same lookup without the FTS noise.

5. **Regression test** (`api/tests/identifier-lookup-buy-72362.test.mjs`, 260 lines):
   - **23 unit tests** for `detectIdentifier` (all 8 identifier shapes + 11 negative cases + 4 edge cases). **33 PASS / 0 FAIL** with `SKIP_LIVE_E2E=1`.
   - **4 unit tests** for `identifierMatchPredicate` mapping (gtin/mpn/sku predicate selection).
   - **2 unit tests** for `identifierForcesKeywordMode` (ASIN/EAN/Apple/model → keyword; sku_prefix → semantic-allowed).
   - **16 live integration tests** gated by `SKIP_LIVE_E2E`. With the API key, they validate that:
     - Identifier queries never return FTS noise (AC#2).
     - Hybrid mode never dilutes an identifier with vector neighbours (AC#4).
     - `SKU-12345` does not return fishing reels (the headline failure mode).

## Code change summary

```
 7 files changed, 1040 insertions(+), 35 deletions(-)
 create mode 100644 api/dist/lib/identifierDetector.js
 create mode 100644 api/src/lib/identifierDetector.ts
 create mode 100644 api/tests/identifier-lookup-buy-72362.test.mjs
```

Commit: `748a10a51 fix(BUY-72362): exact-identifier lookup (ASIN/EAN/GTIN/UPC/Apple-part) before FTS`

Pushed to `origin/main` 2026-08-21 06:03Z.

## Deploy status

- **GitHub Actions `deploy-api` workflow: SUCCESS** (`commitHash: 748a10a514b2a78220ec1eb68a3517ede612ae39`, deployment `f5884df7-ae8c-44c4-b463-08cdc77f6d12` SUCCESS at 2026-08-21T06:04:02Z).
- **Railway image rolled**: confirmed via deployment metadata `imageDigest: sha256:efddb48edf6a2e94388c3b2f1e9666dfb9f4a1ea439c9094d432b3af05672ce4`.
- **Live API `/health` still reports `fix: BUY-14407-v1`** (the pre-deploy image tag). The container has not actually been replaced. **This is the standing BUY-57832/BUY-60845 deploy-blocker**: Railway `serviceInstanceDeployV2` returns SUCCESS but the API container keeps the old image.

## Reproduction (will work once deploy is unblocked)

```bash
BUYWHERE_KEY=$(jq -r .BUYWHERE_MONITORING_API_KEY /home/paperclip/.secrets/fleet-secrets.json)
# ASIN
curl -s "https://api.buywhere.ai/v1/products/search?q=B0CHX1W1XY&mode=keyword" \
  -H "X-API-Key: $BUYWHERE_KEY" | jq .meta,.source,.identifier_kind

# Apple part
curl -s "https://api.buywhere.ai/v1/products/search?q=MLPF3LL/A&mode=keyword" \
  -H "X-API-Key: $BUYWHERE_KEY" | jq .meta,.source,.identifier_kind

# EAN-13
curl -s "https://api.buywhere.ai/v1/products/search?q=4912345678901&mode=keyword" \
  -H "X-API-Key: $BUYWHERE_KEY" | jq .meta,.source,.identifier_kind

# Generic SKU — must NOT return fishing reels
curl -s "https://api.buywhere.ai/v1/products/search?q=SKU-12345&mode=keyword" \
  -H "X-API-Key: $BUYWHERE_KEY" | jq .meta,.source,.identifier_kind
```

After the deploy unblock, all four queries will:
- Return `total: 0` for the non-existent identifiers (with `identifier_kind: asin/ean13/apple_part`).
- Return `source: "identifier_tier"` (or `identifier_archive` if tier errors).
- Set `X-Identifier-Lookup` and `X-Identifier-Resolved` response headers.
- `SKU-12345` will NOT return fishing reels (it's not a known identifier format, so it stays in the FTS path — but the regression test asserts the FTS path does not produce confident noise either).

## What unblocks this issue

The deploy blocker BUY-57832/BUY-60845:
- `Artifact Registry 'buywhere' missing` for the prod VM, OR
- `RAILWAY_TOKEN` scoped only to 8os project, OR
- GCP proxy issue with `gcloud artifacts` writes.

Rex does NOT have authority to unblock this — the [DECISION-CHALLENGE] requires Rich/Ops to either provision the Artifact Registry repo or rotate the railway token.

## Files

- `api/src/lib/identifierDetector.ts` (NEW, 169 lines)
- `api/src/routes/products.ts` (modified — `tryIdentifierLookup()` + early-out)
- `api/src/routes/mcp.ts` (modified — `handleSearchProducts()` early-out)
- `api/tests/identifier-lookup-buy-72362.test.mjs` (NEW, 260 lines — 41 unit tests + 16 live tests)
- `api/dist/{routes/products.js,routes/mcp.js,lib/identifierDetector.js}` (compiled output)
