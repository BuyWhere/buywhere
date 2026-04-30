#!/bin/bash
# Run all working SG scrapers in parallel batches
# Each scraper runs with --scrape-only to output JSONL files
set -e

cd /home/paperclip/buywhere-api
export PYTHONPATH=/home/paperclip/buywhere-api

LOG_DIR=/tmp/scraper_logs
mkdir -p "$LOG_DIR"

echo "=== Starting SG scraper batch run at $(date) ==="

# Batch 1: Amazon SG category scrapers (these are the volume leaders)
echo "Launching Amazon SG category scrapers..."

# Electronics (tested, works)
python3 -m scrapers.amazon_sg_electronics --scrape-only --target 50000 > "$LOG_DIR/amz_electronics.log" 2>&1 &

# Beauty (needs --api-key dummy for required arg)
python3 -m scrapers.amazon_sg_beauty --api-key dummy --scrape-only --target 50000 > "$LOG_DIR/amz_beauty.log" 2>&1 &

# Books (--target-products not --target)
python3 -m scrapers.amazon_sg_books --scrape-only --target-products 50000 > "$LOG_DIR/amz_books.log" 2>&1 &

# Fashion
python3 -m scrapers.amazon_sg_fashion --scrape-only --target 50000 > "$LOG_DIR/amz_fashion.log" 2>&1 &

# Home & Kitchen
python3 -m scrapers.amazon_sg_home_kitchen --scrape-only > "$LOG_DIR/amz_home.log" 2>&1 &

# Grocery (needs --api-key dummy)
python3 -m scrapers.amazon_sg_grocery --api-key dummy --scrape-only --target 50000 > "$LOG_DIR/amz_grocery.log" 2>&1 &

# Baby (needs --api-key dummy)
python3 -m scrapers.amazon_sg_baby --api-key dummy --scrape-only --target 50000 > "$LOG_DIR/amz_baby.log" 2>&1 &

# Sports
python3 -m scrapers.amazon_sg_sports --scrape-only --target 50000 > "$LOG_DIR/amz_sports.log" 2>&1 &

# Toys
python3 -m scrapers.amazon_sg_toys --scrape-only > "$LOG_DIR/amz_toys.log" 2>&1 &

# Garden
python3 -m scrapers.amazon_sg_garden --scrape-only > "$LOG_DIR/amz_garden.log" 2>&1 &

# Pets
python3 -m scrapers.amazon_sg_pets --scrape-only --target 50000 > "$LOG_DIR/amz_pets.log" 2>&1 &

# Office
python3 -m scrapers.amazon_sg_office --scrape-only > "$LOG_DIR/amz_office.log" 2>&1 &

# Tools
python3 -m scrapers.amazon_sg_tools --scrape-only > "$LOG_DIR/amz_tools.log" 2>&1 &

echo "13 Amazon SG category scrapers launched"

# Batch 2: Other SG retailers
echo "Launching SG retailer scrapers..."

python3 -m scrapers.courts_sg --scrape-only > "$LOG_DIR/courts.log" 2>&1 &
python3 -m scrapers.challenger_sg --scrape-only > "$LOG_DIR/challenger.log" 2>&1 &
python3 -m scrapers.bestdenki_sg --scrape-only > "$LOG_DIR/bestdenki.log" 2>&1 &
python3 -m scrapers.harvey_norman_sg --scrape-only > "$LOG_DIR/harvey_norman.log" 2>&1 &
python3 -m scrapers.giant_sg --scrape-only > "$LOG_DIR/giant.log" 2>&1 &
python3 -m scrapers.popular_sg --scrape-only > "$LOG_DIR/popular.log" 2>&1 &
python3 -m scrapers.metro_sg --scrape-only > "$LOG_DIR/metro.log" 2>&1 &
python3 -m scrapers.ebay_sg --scrape-only > "$LOG_DIR/ebay.log" 2>&1 &

echo "8 SG retailer scrapers launched"
echo "Total: 21 scrapers running. Logs in $LOG_DIR/"
echo "Monitor with: tail -f $LOG_DIR/*.log"

wait
echo "=== All scrapers complete at $(date) ==="

# Summary
echo ""
echo "=== Results ==="
for log in "$LOG_DIR"/*.log; do
    name=$(basename "$log" .log)
    if grep -q "total_scraped" "$log" 2>/dev/null; then
        count=$(grep "total_scraped" "$log" | tail -1 | grep -oP "'total_scraped': \K[0-9]+" || echo "?")
        echo "$name: $count products"
    elif grep -q "Scraper complete\|Done\|complete" "$log" 2>/dev/null; then
        echo "$name: completed (check log for count)"
    else
        last=$(tail -1 "$log" 2>/dev/null)
        echo "$name: $last"
    fi
done
