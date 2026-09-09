# GSC Indexing Push Pipeline (BUY-63866 / BUY-72089)

## Overview
Daily pipeline that keeps BuyWhere product URLs fresh in Google Search Console by patching sitemap `<lastmod>` timestamps for recently-updated URLs.

## How it works

1. **Queue Generation** (`generate-indexing-queue.mjs`)
   - Queries the catalog DB for products updated in the last 7 days (168h)
   - Generates 500 recent URLs (products + comparison pages)
   - Writes `content/audits/midnight-indexing-queue-{date}.json`

2. **Lastmod Override** (`update-sitemap-lastmod.mjs`)
   - Reads the queue file
   - Writes `sitemap-lastmod-override-{date}.json` — a URL→timestamp map
   - Writes `sitemap-products-recent-{date}.json` — sitemap entries for recent products

3. **Sitemap Wiring** (`src/lib/sitemaps.ts`)
   - `readLatestLastmodOverride()` reads the latest override JSON and applies fresh `<lastmod>` to matching URLs
   - 24h staleness guard prevents stale dates from persisting

4. **GitHub Workflow** (`.github/workflows/gsc-indexing-push.yml`)
   - Runs daily at 07:05 UTC
   - Runs on workflow_dispatch with optional date override
   - Commits override files back to main for deploy-www pickup

## Why not Google Indexing API?
Google's Indexing API only accepts `JobPosting` and `BroadcastEvent` schemas. Product URLs are not eligible. Sitemap freshness is the Google-supported path for general web pages.

## Files
- `.github/workflows/gsc-indexing-push.yml` — GHA workflow
- `scripts/generate-indexing-queue.mjs` — DB → queue file
- `scripts/update-sitemap-lastmod.mjs` — queue → override files
- `src/lib/sitemaps.ts` — override reader + applyLastmodOverride()

## Testing locally
```bash
# Generate queue (requires DATABASE_URL)
DATABASE_URL="postgresql://..." node scripts/generate-indexing-queue.mjs

# Generate override from queue
OVERRIDE_LASTMOD=2026-08-22T07:05:00.000Z node scripts/update-sitemap-lastmod.mjs 2026-08-22

# Dry-run
node scripts/generate-indexing-queue.mjs --dry-run
```
