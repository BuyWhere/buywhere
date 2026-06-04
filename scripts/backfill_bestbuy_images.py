"""
Backfill image_url for bestbuy_us products where it is currently NULL.

Reads SKUs from DB, constructs product page URLs, scrapes each page for the
image URL (via JSON-LD "image" field or og:image), and updates the DB directly.

Usage:
    python -m scripts.backfill_bestbuy_images [--limit N] [--batch-size N] [--delay F]

Typical Railway run (process 5 000 rows, pause 0.5 s between pages):
    python -m scripts.backfill_bestbuy_images --limit 5000 --delay 0.5
"""

import argparse
import asyncio
import os
import re
import sys
import time
from pathlib import Path

import asyncpg
import httpx
from bs4 import BeautifulSoup

DATABASE_URL = os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    sys.exit("DATABASE_PUBLIC_URL or DATABASE_URL env var required")

BESTBUY_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

_IMG_PATTERNS = [
    re.compile(r'"image"\s*:\s*"(https?://[^"]+)"'),
    re.compile(r'property="og:image"\s+content="(https?://[^"]+)"'),
    re.compile(r'content="(https?://[^"]+)"\s+property="og:image"'),
    re.compile(r'"largeImage"\s*:\s*"(https?://[^"]+)"'),
    re.compile(r'"mediumImage"\s*:\s*"(https?://[^"]+)"'),
]


def _extract_image(html: str) -> str:
    for pat in _IMG_PATTERNS:
        m = pat.search(html)
        if m:
            url = m.group(1)
            if "bestbuy" in url or "bbystatic" in url or "bbysttic" in url:
                return url
    # Accept any CDN image as fallback
    for pat in _IMG_PATTERNS:
        m = pat.search(html)
        if m:
            return m.group(1)
    soup = BeautifulSoup(html, "html.parser")
    for sel in ("img.product-image", "#primary-image", ".product-hero-image img"):
        el = soup.select_one(sel)
        if el:
            src = el.get("src", "") or el.get("data-src", "")
            if src.startswith("http"):
                return src
    return ""


async def fetch_image(client: httpx.AsyncClient, url: str, retries: int = 3) -> str:
    for attempt in range(retries):
        try:
            resp = await client.get(url, timeout=20.0, follow_redirects=True)
            if resp.status_code == 200:
                return _extract_image(resp.text)
            if resp.status_code in (403, 404):
                return ""
        except Exception:
            pass
        if attempt < retries - 1:
            await asyncio.sleep(2 ** attempt)
    return ""


async def run(limit: int, batch_size: int, delay: float) -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch(
            """
            SELECT sku, url
            FROM products
            WHERE source = 'bestbuy_us'
              AND country_code = 'US'
              AND (image_url IS NULL OR image_url = '')
            ORDER BY updated_at ASC
            LIMIT $1
            """,
            limit,
        )
    finally:
        await conn.close()

    total = len(rows)
    print(f"Found {total} bestbuy_us US rows with NULL/empty image_url", flush=True)
    if not total:
        print("Nothing to backfill.")
        return

    filled = 0
    failed = 0
    start = time.time()

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        async with httpx.AsyncClient(headers=BESTBUY_HEADERS) as client:
            batch_updates: list[tuple[str, str]] = []

            for idx, row in enumerate(rows, 1):
                sku: str = row["sku"]
                url: str = row["url"] or f"https://www.bestbuy.com/site/product/{sku}.p?skuId={sku}"

                image_url = await fetch_image(client, url)
                if image_url:
                    batch_updates.append((image_url, sku))
                    filled += 1
                else:
                    failed += 1

                if len(batch_updates) >= batch_size:
                    await conn.executemany(
                        "UPDATE products SET image_url=$1, updated_at=NOW() WHERE sku=$2 AND source='bestbuy_us'",
                        batch_updates,
                    )
                    batch_updates = []

                if idx % 100 == 0 or idx == total:
                    elapsed = time.time() - start
                    rate = idx / elapsed if elapsed else 0
                    eta = (total - idx) / rate if rate else 0
                    print(
                        f"[{idx}/{total}] filled={filled} failed={failed} "
                        f"rate={rate:.1f}/s eta={eta:.0f}s",
                        flush=True,
                    )

                await asyncio.sleep(delay)

            if batch_updates:
                await conn.executemany(
                    "UPDATE products SET image_url=$1, updated_at=NOW() WHERE sku=$2 AND source='bestbuy_us'",
                    batch_updates,
                )
    finally:
        await conn.close()

    print(f"\nDone: {filled}/{total} images backfilled, {failed} pages returned no image.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill bestbuy_us image_url from product pages")
    parser.add_argument("--limit", type=int, default=50_000, help="Max rows to process (default 50 000)")
    parser.add_argument("--batch-size", type=int, default=50, help="DB update batch size (default 50)")
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds between page requests (default 0.5)")
    args = parser.parse_args()
    asyncio.run(run(args.limit, args.batch_size, args.delay))


if __name__ == "__main__":
    main()
