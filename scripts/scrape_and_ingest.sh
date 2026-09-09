#!/bin/bash
set -e

SCRAPER_PID=$1
DATA_DIR="/home/paperclip/buywhere-api/data/fairprice_scrape"
LOG="$DATA_DIR/scrape_and_ingest.log"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) Waiting for scraper PID $SCRAPER_PID to complete..." | tee -a "$LOG"

while kill -0 "$SCRAPER_PID" 2>/dev/null; do
    PRODUCT_COUNT=$(wc -l < "$DATA_DIR"/products_20260515_170545.jsonl 2>/dev/null || echo 0)
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) Scraper running, products so far: $PRODUCT_COUNT" | tee -a "$LOG"
    sleep 60
done

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) Scraper finished. Starting ingestion..." | tee -a "$LOG"

PRODUCT_COUNT=$(wc -l < "$DATA_DIR"/products_20260515_170545.jsonl 2>/dev/null || echo 0)
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) Total products scraped: $PRODUCT_COUNT" | tee -a "$LOG"

cd /home/paperclip/buywhere-api
node scripts/ingest_fairprice_ndjson.js "$DATA_DIR" 2>&1 | tee -a "$LOG"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) Done." | tee -a "$LOG"
