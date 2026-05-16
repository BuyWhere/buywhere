# BUY-14185 Domain Source Gathering

## What Landed

- Added [scripts/domain_source_gatherer.py](/home/paperclip/buywhere-api/scripts/domain_source_gatherer.py) to gather and normalize candidate domains from Common Crawl, BuiltWith, and Store Leads.
- Output is written to `data/domains/` as:
  - `combined_candidates_latest.jsonl`
  - timestamped `combined_candidates_*.jsonl`
  - `source_manifest.json`

## Source Behavior

- Common Crawl:
  - pulls the latest crawl collections from `collinfo.json`
  - queries configurable Shopify and WooCommerce footprint patterns
  - throttles requests to respect Common Crawl rate-limit guidance
- BuiltWith:
  - uses the Lists API with `BUILTWITH_API_KEY`
  - normalizes returned domains into the shared candidate schema
- Store Leads:
  - uses the domain search API with `STORELEADS_API_KEY`
  - paginates with `next_cursor` when present

## Run

Dry-run:

```bash
python3 scripts/domain_source_gatherer.py --dry-run
```

Import offline candidate files (no API required):

```bash
python3 scripts/domain_source_gatherer.py \
  --sources imports \
  --import-paths /path/to/domains.jsonl,/path/to/domains.csv,/path/to/partner-gallery.html \
  --import-platform shopify
```

Supported import formats:
- `TXT`: one domain per line
- `CSV`: `domain` / `website` / `url` style columns, or first column fallback
- `JSON` / `JSONL`: arrays or objects containing `domain` / `url` / `website` fields
- `HTML`: saved public directory / gallery pages; importer extracts external merchant links

Oracle review follow-up:
- Best path from current infrastructure is `imports` with pre-fetched artifacts.
- Highest-yield artifact candidates are Shopify App Store “Built by” pages, partner galleries, and CSV exports from public directories.

Scrape public aggregator pages (no API key required):

```bash
python3 scripts/domain_source_gatherer.py --sources public_pages
```

Optional domain filter for public pages:

```bash
python3 scripts/domain_source_gatherer.py \
  --sources public_pages \
  --public-page-regex 'shop|store|boutique'
```

Common Crawl only:

```bash
python3 scripts/domain_source_gatherer.py --sources commoncrawl
```

Full run:

```bash
BUILTWITH_API_KEY=... STORELEADS_API_KEY=... \
python3 scripts/domain_source_gatherer.py
```

## Current Blocker

The repo now has the actual gatherer implementation, but a production run still depends on valid `BUILTWITH_API_KEY` and `STORELEADS_API_KEY` credentials in the runtime environment.
