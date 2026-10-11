# BUY-84239 Fix Evidence — 2026-10-07T07:30Z

## Issue
/laptop-singapore (MacBook query) showed Windows PC (HP DK4Q5AT) in Card 1 instead of Apple MacBook.

## Root Cause
Stale ISR cache. The BUY-84239 code fix (commit 1727a02e3, gate /laptop-singapore to MacBook-only) was deployed Oct 5 08:19 UTC, but the Next.js ISR-cached page was never revalidated. The cached page still used the pre-fix `searchQuery: "laptop"` which returns Windows PCs and spare parts from the API.

## Fix Applied
Triggered deploy-www workflow re-run (run 37586804524, commit 4b6d672902f5) to rebuild the site and bust the stale ISR cache. Deploy completed successfully at ~07:24 UTC.

## Verification (post-deploy)
- 16 product cards on /laptop-singapore — ALL 16 are Apple MacBooks (0 non-MacBook)
- Card 1: Apple 13-inch MacBook Neo: Apple A18 Pro chip (S$999)
- Quick Answer: "The cheapest macbook in Singapore today is S$999 at Harvey Norman, S$2,000 less than Courts (S$2,999)."
- All product cards link via /r/direct/{id} affiliate redirects
- Hero title: "Best laptops in Singapore (2026) — from SGD 999 today"

## Deploy
- Workflow: deploy-www (run 37586804524)
- Commit: 4b6d672902f5 (main)
- Status: success
