# BUY-3482 Zalora ID Deduplication Analysis

Date: 2026-04-19

## Scope

This analysis uses the local scrape artifacts present in `/home/paperclip/buywhere-api/data`.
The checked-in SQLite files in this repo are empty, so there is no catalog snapshot to query directly.
The goal here is to quantify the duplicate risk around `zalora_id` and define the cleanup approach for canonicalization.

## Inputs

- `data/zalora_id_new_sitemap/zalora_id_new_20260418_170904.jsonl`
- `data/zalora_id_new_sitemap/zalora_id_new_20260418_170853.jsonl`
- `data/zalora_id_fast/zalora_id_fast_20260418_171222.jsonl`
- `data/zalora_sg_20260418.ndjson`
- `data/zalora_my_sitemap/zalora_my_20260418.ndjson`
- `data/zalora_hk_sitemap/zalora_hk_20260418_165944.jsonl`
- `data/zalora_ph_sitemap/zalora_ph_20260418_165535.jsonl`

Validation command:

```bash
python3 scripts/analyze_zalora_id_dedup.py
```

## Findings

### 1. Within-run duplicate `zalora_id` usage is currently zero in the main sitemap export

- `zalora_id_new_20260418_170904.jsonl`: 4,704 rows, 4,704 unique SKUs, 0 duplicate groups
- `zalora_id_new_20260418_170853.jsonl`: 3 rows, 3 unique SKUs, 0 duplicate groups
- `zalora_id_fast_20260418_171222.jsonl`: 0 rows

Interpretation: the current sitemap scraper is not emitting repeated `sku` values inside the same output file.

### 2. We do have a rerun/resume artifact

- The 3-row `170853` file is an exact overlap with the first successful sitemap run.
- Overlap SKUs: `896649`, `896653`, `896654`

Interpretation: this is harmless only if ingestion preserves a stable `source` key and upserts on `(sku, source)`. It becomes noisy if every restart is treated as a new source alias or as a new raw file without checkpointing.

### 3. Confirmed cross-country SKU collisions exist between Zalora ID and Zalora MY

From the latest local scrape artifacts:

- `zalora_id` vs `zalora_my`: 3 overlapping numeric SKUs
- `zalora_id` vs `zalora_sg`: 0
- `zalora_id` vs `zalora_hk`: 0
- `zalora_id` vs `zalora_ph`: 0

Sample collisions:

| SKU | Zalora ID title | Zalora MY title |
| --- | --- | --- |
| `4248472` | `Ladies Sandal 30270Za` | `Asia Fit Nylon Chino Midi Skirt - Tommy Mainline` |
| `4252160` | `Puma Smash Cat L` | `Radio Vibe T-Shirt` |
| `4265438` | `Steve Madden JEDDA Women's Shoes Flats- Clear` | `CHANEL - Les Beiges Healthy Glow Sheer Powder - # B30 12g/0.42oz` |

Interpretation: numeric product IDs are not globally unique across Zalora countries. Any ingestion path that collapses all Zalora regions into a shared key will eventually overwrite unrelated records.

## Root-Cause Buckets

### Bucket A: Resume/retry overlap

Cause:

- Multiple raw files can contain the same `zalora_id` SKUs after retries or interrupted runs.

Evidence:

- The `170853` 3-row partial file is fully duplicated by `170904`.

Impact:

- Low if ingestion uses `(sku, source)` and source remains stable.
- Medium if file-based workflows reprocess every artifact without run-level checkpointing.

### Bucket B: Source alias fragmentation

Observed aliases in code and data paths:

- `zalora_id`
- `zalora_id_fast`
- `zalora_id_new`
- `zalora_id_new_sitemap`
- `zalora`

Cause:

- Scrapers, ingestion helpers, and direct-ingest scripts use different naming layers for the same country feed.

Impact:

- The same Indonesia catalog can land under multiple identities, preventing clean upserts and making downstream canonicalization ambiguous.

### Bucket C: Region collapse onto `platform='zalora'`

Cause:

- Several direct-ingest paths use `ON CONFLICT (platform, sku)` and map all regional Zalora sources to `platform='zalora'`.

Evidence:

- `scripts/ingest_deduped_batch.py` maps `zalora_sg`, `zalora_my`, `zalora_id`, `zalora_ph`, `zalora_hk`, `zalora_id_new`, and `zalora_id_new_sitemap` to the same platform value.
- `scripts/ingestion_cron.py`, `scripts/auto_ingest.py`, and `scripts/ingest_scraped_dir.py` use `ON CONFLICT (platform, sku)`.
- We have 3 confirmed `zalora_id`/`zalora_my` SKU collisions with unrelated titles.

Impact:

- High. This is the real data corruption risk. Country-specific products can overwrite one another even when the scrape output itself is clean.

## Recommended Cleanup Plan

### Phase 1: Stop the bleed

1. Standardize the canonical source for Indonesia to `zalora_id`.
2. Treat `zalora_id_new`, `zalora_id_new_sitemap`, and `zalora_id_fast` as ingestion aliases that normalize to `zalora_id`.
3. Block any new Zalora ingest that keys uniqueness on `(platform, sku)` alone.

### Phase 2: Make keys country-safe

1. Preserve country-qualified uniqueness in storage, preferably `(source, sku)`.
2. If legacy tables still require `platform`, derive it separately for analytics/search but do not use it as the write conflict key.
3. Backfill a `canonical_source` or `normalized_source` field so historical alias rows can be grouped without losing their original raw source.

### Phase 3: Catalog cleanup

1. Identify rows whose raw source is one of `zalora_id_new`, `zalora_id_new_sitemap`, or `zalora_id_fast`.
2. Re-key them to `zalora_id` when their payload is semantically the same Indonesia feed.
3. Deactivate or merge exact duplicate `(zalora_id, sku)` rows created by alias drift.
4. Audit any rows written through a legacy `platform='zalora'` table for cross-country SKU collisions before further merges.

### Phase 4: Guardrails

1. Add an ingest validation test that asserts Zalora region pairs can share the same numeric SKU without conflict.
2. Add a pre-ingest quality check that flags source aliases outside the approved set.
3. Add resume metadata or checkpoint files so partial reruns do not produce overlapping raw artifacts silently.

## Launch-Relevant Recommendation

Do not spend time building fuzzy canonicalization for Zalora ID right now. The launch-relevant fix is simpler:

- normalize all Indonesia variants to `zalora_id`
- keep uniqueness country-scoped
- clean alias drift
- reject platform-only conflicts for Zalora

That removes the known corruption path without needing proxy work or large-scale manual review.

## Remaining Risks

- No live catalog snapshot was available in this repo, so the report cannot yet quantify how many bad rows already exist in production or staging.
- The local artifacts are partial regional samples, not full-country exports for every market.
- If other ingestion codepaths outside this repo still write `(platform, sku)`, the collision risk remains until they are updated.
