#!/usr/bin/env python3
"""Post-ingest cleanup for thehoffbrand.com (BUY-77369)."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import psycopg2

MERCHANT_ID = "thehoffbrand.com"
INGEST_TS = "2026-08-29T19:55:00"
R2_KEY = "shelf/thehoffbrand.com/20260829T195537Z_products.json"
REPORT_PATH = Path(os.environ.get("PAPERCLIP_RUN_SCRATCH_DIR", "/tmp")) / "thehoffbrand_cleanup_report.json"


def main():
    dsn = open("/home/paperclip/buywhere/data/.catalog_db_url").read().strip()
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    cur.execute("SET statement_timeout = 0")

    cur.execute(
        "SELECT COUNT(*), COUNT(DISTINCT sku) FROM public.products WHERE merchant_id = %s",
        (MERCHANT_ID,),
    )
    before_total, before_skus = cur.fetchone()

    cur.execute(
        """
        UPDATE public.products
        SET is_active = false, is_available = false, in_stock = false, updated_at = NOW()
        WHERE merchant_id = %s AND updated_at < %s
        """,
        (MERCHANT_ID, INGEST_TS),
    )
    deactivated = cur.rowcount

    cur.execute(
        """
        UPDATE public.products
        SET url_status = 'dead', url_dead_at = NOW(), updated_at = NOW()
        WHERE merchant_id = %s AND is_active = false AND url_status IS DISTINCT FROM 'dead'
        """,
        (MERCHANT_ID,),
    )
    marked_dead = cur.rowcount

    cur.execute(
        "SELECT COUNT(*) FROM public.products WHERE merchant_id = %s AND is_active = true",
        (MERCHANT_ID,),
    )
    active_count = cur.fetchone()[0]

    cur.execute(
        """
        UPDATE public.merchants
        SET onboarding_stage = 'ingested', products_count = %s, updated_at = NOW()
        WHERE id = %s
        """,
        (active_count, MERCHANT_ID),
    )
    merchant_updated = cur.rowcount

    conn.commit()

    # Also update the myshopify.com duplicate row if it exists, to avoid confusion
    cur.execute(
        """
        UPDATE public.merchants
        SET onboarding_stage = 'duplicate', updated_at = NOW()
        WHERE domain = 'thehoffbrand.myshopify.com' AND id != %s
        """,
        (MERCHANT_ID,),
    )
    myshopify_updated = cur.rowcount
    conn.commit()
    conn.close()

    report = {
        "issue": "BUY-77369",
        "domain": MERCHANT_ID,
        "before_total_rows": before_total,
        "before_distinct_skus": before_skus,
        "deactivated_rows": deactivated,
        "marked_dead_rows": marked_dead,
        "active_catalog_count": active_count,
        "merchant_rows_updated": merchant_updated,
        "myshopify_duplicate_rows_marked": myshopify_updated,
        "r2_key": R2_KEY,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
