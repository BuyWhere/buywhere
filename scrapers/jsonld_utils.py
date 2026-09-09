"""
Shared JSON-LD extraction utilities for GTIN/EAN/UPC/MPN.

Extracts product identifiers from Schema.org JSON-LD embedded in merchant product pages.
Supports gtin, gtin12, gtin13, gtin14, gtin8, mpn, and sku fields.
"""

import asyncio
import json
import re
from typing import Any, Optional

import httpx


def parse_jsonld_script(html: str) -> list[dict[str, Any]]:
    """Extract and parse all application/ld+json script blocks from HTML."""
    items: list[dict[str, Any]] = []
    pattern = r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>'
    for match in re.finditer(pattern, html, re.DOTALL | re.IGNORECASE):
        try:
            data = json.loads(match.group(1).strip())
            if isinstance(data, list):
                items.extend(data)
            else:
                items.append(data)
        except json.JSONDecodeError:
            continue
    return items


def extract_product_identifiers(html: str) -> dict[str, Optional[str]]:
    """Extract gtin, mpn, and sku from JSON-LD product markup.

    Searches all JSON-LD script blocks for @type: Product nodes and
    extracts standard identifier fields. Returns the first non-null match
    for each identifier type.

    Returns:
        dict with keys: gtin, mpn, sku (values are str or None)
    """
    result: dict[str, Optional[str]] = {"gtin": None, "mpn": None, "sku": None}
    blocks = parse_jsonld_script(html)

    for block in blocks:
        if not isinstance(block, dict):
            continue
        if block.get("@type") != "Product":
            continue

        if not result["gtin"]:
            for field in ("gtin14", "gtin13", "gtin12", "gtin8", "gtin"):
                val = block.get(field)
                if val:
                    cleaned = str(val).strip()
                    if cleaned:
                        result["gtin"] = cleaned
                        break

        if not result["mpn"]:
            val = block.get("mpn")
            if val:
                cleaned = str(val).strip()
                if cleaned:
                    result["mpn"] = cleaned

        if not result["sku"]:
            val = block.get("sku")
            if val:
                cleaned = str(val).strip()
                if cleaned:
                    result["sku"] = cleaned

        if result["gtin"] and result["mpn"]:
            break

    return result


def looks_like_gtin(value: str) -> bool:
    """Check if a string looks like a valid GTIN (8, 12, 13, or 14 digits)."""
    cleaned = re.sub(r"\D", "", value)
    return len(cleaned) in (8, 12, 13, 14) and cleaned == value.strip()


async def fetch_and_extract_identifiers(
    url: str,
    client: httpx.AsyncClient,
    semaphore: Optional[asyncio.Semaphore] = None,
    retries: int = 2,
) -> dict[str, Optional[str]]:
    """Fetch a product page and extract GTIN/MPN from its JSON-LD.

    Args:
        url: Product page URL.
        client: Shared httpx client.
        semaphore: Optional semaphore for concurrency limiting.
        retries: Number of retry attempts.

    Returns:
        dict with keys: gtin, mpn, sku
    """
    default = {"gtin": None, "mpn": None, "sku": None}
    coro = _fetch_and_extract_inner(url, client, retries)

    if semaphore:
        async with semaphore:
            return await coro
    return await coro


async def _fetch_and_extract_inner(
    url: str, client: httpx.AsyncClient, retries: int
) -> dict[str, Optional[str]]:
    for attempt in range(retries):
        try:
            resp = await client.get(url, follow_redirects=True, timeout=15.0)
            if resp.status_code == 200:
                return extract_product_identifiers(resp.text)
        except Exception:
            if attempt < retries - 1:
                await asyncio.sleep(2**attempt)
    return {"gtin": None, "mpn": None, "sku": None}


async def enrich_batch_with_identifiers(
    batch: list[dict[str, Any]],
    url_key: str,
    client: httpx.AsyncClient,
    max_concurrent: int = 5,
    retries: int = 2,
) -> list[dict[str, Any]]:
    """Fetch product pages for a batch and enrich each item with gtin/mpn.

    Only fetches for items that don't already have a gtin value.
    Uses url_key to find the product URL in each item dict.

    Args:
        batch: List of product dicts.
        url_key: Dict key for the product URL (e.g. "url" or "product_url").
        client: Shared httpx client.
        max_concurrent: Max concurrent fetches.

    Returns:
        Updated batch with gtin/mpn fields populated where found.
    """
    semaphore = asyncio.Semaphore(max_concurrent)
    tasks = []

    for item in batch:
        if item.get("gtin"):
            tasks.append(None)
            continue
        product_url = item.get(url_key) or ""
        if not product_url:
            tasks.append(None)
            continue
        tasks.append(fetch_and_extract_identifiers(product_url, client, semaphore, retries))

    results = await asyncio.gather(*[t for t in tasks if t is not None])

    result_idx = 0
    for i, item in enumerate(batch):
        if tasks[i] is None:
            continue
        identifiers = results[result_idx]
        result_idx += 1
        if identifiers.get("gtin") and not item.get("gtin"):
            item["gtin"] = identifiers["gtin"]
        if identifiers.get("mpn") and not item.get("mpn"):
            item["mpn"] = identifiers["mpn"]
        if identifiers.get("sku") and not item.get("sku"):
            item["sku"] = identifiers["sku"]

    return batch
