# BUY-56824 — Safe Workspace Disk Cleanup Sweep

**Date:** 2026-06-24
**Disk before:** 2.3 GB workspace; 65% filesystem
**Disk after:** 1.9 GB workspace; 64% filesystem
**Freed:** ~400 MB

## What was removed

### data/ (614 MB → 187 MB, 427 MB freed)
- `data/carousell-sg/products_20260516_*.jsonl` — 3 files × ~74 MB each (~221 MB)
- `data/fairprice_scrape/products_20260515_*.jsonl` — 2 files (~61 MB)
- `data/bestbuy_us/products_*.jsonl` + `urls_*.txt` — 8 files (~41 MB)
- `data/superiorlighting_us/products_*.jsonl` — 8 files (~22 MB)
- `data/toys_sg/products_*.jsonl` — 4 files (~24 MB)
- `data/books_sg/products_*.jsonl` — 2 files (~22 MB)
- `data/automotive_sg/products_*.jsonl` — 2 files (~19 MB)
- `data/selffix-sg/products*.jsonl` + rescue/merged — 5 files (~13 MB)
- `data/zeelool_us/products_*.jsonl` — 2 files (~7 MB)

### BUY-*-evidence/ (~800 KB → 36 KB, ~760 KB freed)
Removed 43 untracked/gitignored transient evidence directories (BUY-56647 through BUY-56825).
Kept `BUY-56632-evidence/` which is tracked in git (real prior work product).

### Python bytecode caches
- `app/__pycache__/`, `app/models/__pycache__/`, `scrapers/__pycache__/`, `scripts/__pycache__/`

## What was preserved
- `data/shopify_candidate_validation/` (184 MB) — git-tracked BUY-18309 work products
- `data/carousell-sg/scheduler_state.json` + `scraper.log` — live runtime state
- `data/buy31015-*` — live WC lane supervisor state (PID 211727 active)
- `data/carousell-sg/summary_*.json` — recent scheduler summaries
- `data/superiorlighting_us/checkpoint.json` — resume checkpoint
- `data/selffix-sg/BUY-16841-COMPLETED.md` — completion note
- `node_modules/`, `api/node_modules/`, `api/dist/` — required for build/run
- `logs/` — actively written by live watchdog/scheduler processes
- All source code modifications (untouched — left for other agents' work)

## Approach (matches BUY-56624 precedent)
1. `du` survey identified largest reclaimable items
2. Checked `git ls-files` + `git status` per path — only deleted files that were either:
   - Tracked but stale (May 14–16, ~40 days old), OR
   - Untracked / gitignored runtime artifacts
3. Verified no live processes depend on deleted files (carousell-sg scheduler inactive, buy31015 PID 211727 still running with its current dated file)
4. `git rm` for tracked files, `rm -rf` for untracked/gitignored
5. Cleared `__pycache__/` directories

## Verification
- Disk usage: 2.3 GB → 1.9 GB (~17% reduction)
- Filesystem: 65% → 64% utilization
- No live processes interrupted
- Source tree modifications preserved
