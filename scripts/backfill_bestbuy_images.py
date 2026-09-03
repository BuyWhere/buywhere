"""
Backfill image_url for bestbuy_us products where it is currently NULL.

Reads SKUs from DB, constructs product page URLs, scrapes each page with
Playwright for the image URL (via JSON-LD "image" field or og:image), and
updates the DB directly. Uses Playwright because Best Buy requires JavaScript
rendering to expose the image URL in page JSON-LD.

Usage:
    python -m scripts.backfill_bestbuy_images [--limit N] [--batch-size N] [--delay F]

Example (process 5 000 rows, 0.5 s between pages):
    DATABASE_PUBLIC_URL=... python -m scripts.backfill_bestbuy_images --limit 5000 --delay 0.5
"""

import argparse
import asyncio
import os
import re
import sys
import time

import asyncpg
from playwright.async_api import async_playwright, Error as PlaywrightError

from pathlib import Path as _P
sys.path.insert(0, str(_P(__file__).resolve().parent.parent))
import catalog_guard  # fail-fast: bulk writes only ever target maglev
DATABASE_URL = os.environ.get("DATABASE_PUBLIC_URL") or os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    sys.exit("DATABASE_PUBLIC_URL or DATABASE_URL env var required")
catalog_guard.assert_catalog_url(DATABASE_URL, "env")

_HEADERS = {
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


def _extract_image_from_html(html: str) -> str:
    for pat in _IMG_PATTERNS:
        m = pat.search(html)
        if m:
            url = m.group(1)
            if "bestbuy" in url.lower() or "bbystatic" in url.lower():
                return url
    for pat in _IMG_PATTERNS:
        m = pat.search(html)
        if m:
            return m.group(1)
    return ""


async def fetch_image_playwright(context, url: str, retries: int = 3) -> str:
    for attempt in range(retries):
        page = None
        try:
            page = await context.new_page()
            resp = await page.goto(url, timeout=30_000)
            if resp and resp.status == 403:
                return ""
            await page.wait_for_timeout(2000)
            html = await page.content()
            return _extract_image_from_html(html)
        except PlaywrightError as exc:
            if attempt < retries - 1:
                await asyncio.sleep(2 ** attempt)
            else:
                print(f"  playwright error on {url}: {exc}", flush=True)
                return ""
        finally:
            if page:
                await page.close()
    return ""


async def run(limit: int, batch_size: int, delay: float) -> None:
    db = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await db.fetch(
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
        await db.close()

    total = len(rows)
    print(f"Found {total} bestbuy_us US rows with NULL/empty image_url", flush=True)
    if not total:
        print("Nothing to backfill.")
        return

    filled = 0
    failed = 0
    start = time.time()

    db = await asyncpg.connect(DATABASE_URL)
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=True)
    ctx = await browser.new_context(
        locale="en-US",
        timezone_id="America/New_York",
        user_agent=_HEADERS["User-Agent"],
    )

    try:
        batch_updates: list[tuple[str, str]] = []

        for idx, row in enumerate(rows, 1):
            sku: str = row["sku"]
            url: str = row["url"] or f"https://www.bestbuy.com/site/product/{sku}.p?skuId={sku}"

            image_url = await fetch_image_playwright(ctx, url)
            if image_url:
                batch_updates.append((image_url, sku))
                filled += 1
            else:
                failed += 1

            if len(batch_updates) >= batch_size:
                await db.executemany(
                    "UPDATE products SET image_url=$1, updated_at=NOW() "
                    "WHERE sku=$2 AND source='bestbuy_us'",
                    batch_updates,
                )
                batch_updates = []

            if idx % 50 == 0 or idx == total:
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
            await db.executemany(
                "UPDATE products SET image_url=$1, updated_at=NOW() "
                "WHERE sku=$2 AND source='bestbuy_us'",
                batch_updates,
            )
    finally:
        await ctx.close()
        await browser.close()
        await pw.stop()
        await db.close()

    print(f"\nDone: {filled}/{total} images backfilled, {failed} pages returned no image.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill bestbuy_us image_url from product pages"
    )
    parser.add_argument(
        "--limit", type=int, default=50_000, help="Max rows to process (default 50 000)"
    )
    parser.add_argument(
        "--batch-size", type=int, default=50, help="DB update batch size (default 50)"
    )
    parser.add_argument(
        "--delay", type=float, default=0.5, help="Seconds between page requests (default 0.5)"
    )
    args = parser.parse_args()
    asyncio.run(run(args.limit, args.batch_size, args.delay))


if __name__ == "__main__":
    main()
