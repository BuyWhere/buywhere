#!/usr/bin/env python3
"""
Backfill affiliate_url for all products that don't have an entry in the affiliate_links table.

This script:
1. Finds all products that don't have an affiliate link entry
2. Generates affiliate URLs using the affiliate_links module
3. Inserts them into the affiliate_links table in batches

Usage:
    python scripts/backfill_affiliate_urls.py [--batch-size 1000] [--platform <platform>]
"""
import argparse
import os
import sys

sys.path.insert(0, "/home/paperclip/buywhere-api")

from app.affiliate_links import get_affiliate_url
import psycopg2
from psycopg2.extras import execute_batch

BATCH_SIZE = 1000

DB_URL = os.environ.get("DATABASE_URL", "postgresql://buywhere:buywhere@172.18.0.4:5432/buywhere")


def backfill_affiliate_urls(batch_size: int = BATCH_SIZE, platform: str | None = None) -> int:
    """Backfill affiliate URLs for products missing them.
    
    Args:
        batch_size: Number of records to process in each batch
        platform: Optional platform filter (e.g., 'shopee_sg', 'lazada_sg')
    
    Returns:
        Number of affiliate links created
    """
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    where_clause = "WHERE al.id IS NULL"
    params = []
    if platform:
        where_clause += " AND p.source = %s"
        params.append(platform)

    total_inserted = 0

    while True:
        query = f"""
            SELECT p.id, p.url, p.source
            FROM products p
            LEFT JOIN affiliate_links al ON p.id = al.product_id
            {where_clause}
            ORDER BY p.id
            LIMIT 10000
        """

        cur.execute(query, params)
        rows = cur.fetchall()
        print(f"Found {len(rows)} products without affiliate links." + (f" (platform: {platform})" if platform else ""))

        if not rows:
            break

        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            data = []
            for product_id, url, source in batch:
                if not url:
                    continue
                affiliate_url = get_affiliate_url(source, url, product_id)
                data.append((
                    product_id,
                    source,
                    url,
                    affiliate_url,
                    None,
                    get_program_name(source),
                    get_commission_pct(source),
                ))

            if data:
                insert_sql = """
                    INSERT INTO affiliate_links (product_id, platform, raw_url, affiliate_url, tracking_id, program, commission_pct)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (product_id) DO UPDATE SET
                        affiliate_url = EXCLUDED.affiliate_url,
                        raw_url = EXCLUDED.raw_url,
                        platform = EXCLUDED.platform
                """
                execute_batch(cur, insert_sql, data, page_size=1000)
                conn.commit()
                total_inserted += len(data)
                print(f"Inserted batch of {len(data)} affiliate links (total: {total_inserted})")

    cur.close()
    conn.close()
    print(f"Total affiliate links created: {total_inserted}")
    return total_inserted


def get_program_name(source: str) -> str:
    """Get the affiliate program name for a source."""
    program_map = {
        "shopee_sg": "Shopee Affiliate",
        "lazada_sg": "Lazada Affiliate",
        "amazon_sg": "Amazon Associates",
        "amazon_us": "Amazon Associates",
        "amazon_com": "Amazon Associates",
        "asos_sg": "AWIN",
        "challenger": "Challenger Affiliate",
        "challenger.sg": "Challenger Affiliate",
        "challenger_sg": "Challenger Affiliate",
        "decathlon": "Decathlon Affiliate",
        "decathlon_sg": "Decathlon Affiliate",
        "hp_sg": "AWIN",
        "lenovo_sg": "AWIN",
        "underarmour_sg": "AWIN",
        "etsy_sg": "AWIN",
        "marksandspencer_sg": "AWIN",
    }
    return program_map.get(source, "Direct")


def get_commission_pct(source: str) -> float:
    """Get the typical commission percentage for a source."""
    commission_map = {
        "shopee_sg": 5.0,
        "lazada_sg": 5.0,
        "amazon_sg": 5.0,
        "amazon_us": 5.0,
        "amazon_com": 5.0,
        "asos_sg": 3.0,
        "challenger": 0.0,
        "challenger.sg": 0.0,
        "challenger_sg": 0.0,
        "decathlon": 0.0,
        "decathlon_sg": 0.0,
        "hp_sg": 3.0,
        "lenovo_sg": 3.0,
        "underarmour_sg": 5.0,
        "etsy_sg": 3.0,
        "marksandspencer_sg": 5.0,
    }
    return commission_map.get(source, 0.0)


def main():
    parser = argparse.ArgumentParser(description="Backfill affiliate URLs for products")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=BATCH_SIZE,
        help=f"Batch size for insertion (default: {BATCH_SIZE})",
    )
    parser.add_argument(
        "--platform",
        type=str,
        default=None,
        help="Optional platform filter (e.g., shopee_sg, lazada_sg)",
    )
    args = parser.parse_args()

    backfill_affiliate_urls(batch_size=args.batch_size, platform=args.platform)


if __name__ == "__main__":
    main()
