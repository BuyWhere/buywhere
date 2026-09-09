"""Selffix Singapore product scraper.

Scrapes product pages listed in the BigCommerce product sitemap and writes
normalized JSONL records for BuyWhere ingestion.

Usage:
    python3 -m scrapers.selffix_sg --scrape-only
    python3 -m scrapers.selffix_sg --limit 100
"""

import argparse
import asyncio
import html
import json
import re
import time
from pathlib import Path
from typing import Any

import httpx

from scrapers.jsonld_utils import parse_jsonld_script
from scrapers.scraper_logging import get_logger

MERCHANT_ID = "selffix_sg"
SOURCE = "selffix_sg"
BASE_URL = "https://www.selffix.com"
SITEMAP_URL = f"{BASE_URL}/xmlsitemap.php?type=products&page=1"
OUTPUT_DIR = Path("/home/paperclip/buywhere-api/data/selffix-sg")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-SG,en;q=0.9",
    "Referer": BASE_URL,
}

log = get_logger(MERCHANT_ID)


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def strip_tags(value: str | None) -> str:
    if not value:
        return ""
    no_scripts = re.sub(r"<script.*?</script>", " ", value, flags=re.DOTALL | re.IGNORECASE)
    no_tags = re.sub(r"<[^>]+>", " ", no_scripts)
    return clean_text(no_tags)


def flatten_jsonld(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flat: list[dict[str, Any]] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        graph = block.get("@graph")
        if isinstance(graph, list):
            for item in graph:
                if isinstance(item, dict):
                    flat.append(item)
        flat.append(block)
    return flat


def extract_bcdata(html: str) -> dict[str, Any]:
    match = re.search(r"var BCData = (\{.*?\});", html, re.DOTALL)
    if not match:
        return {}
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}


def first_non_empty(*values: Any) -> str:
    for value in values:
        if isinstance(value, str):
            cleaned = clean_text(value)
            if cleaned:
                return cleaned
    return ""


def parse_price(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        match = re.search(r"(\d[\d,]*(?:\.\d+)?)", value)
        if match:
            try:
                return float(match.group(1).replace(",", ""))
            except ValueError:
                return None
    return None


def extract_product_block(flat_blocks: list[dict[str, Any]]) -> dict[str, Any]:
    for block in flat_blocks:
        block_type = block.get("@type")
        if block_type == "Product":
            return block
        if isinstance(block_type, list) and "Product" in block_type:
            return block
    return {}


def extract_breadcrumbs(flat_blocks: list[dict[str, Any]]) -> list[str]:
    for block in flat_blocks:
        block_type = block.get("@type")
        if block_type != "BreadcrumbList":
            continue
        items = block.get("itemListElement")
        if not isinstance(items, list):
            continue
        names: list[str] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            name = None
            inner = item.get("item")
            if isinstance(inner, dict):
                name = inner.get("name")
            if not name:
                name = item.get("name")
            cleaned = clean_text(str(name or ""))
            if cleaned and cleaned.lower() != "home":
                names.append(cleaned)
        if names:
            return names
    return []


def normalize_sku_and_gtin(raw_sku: str, current_gtin: str) -> tuple[str, str]:
    sku = clean_text(raw_sku)
    gtin = clean_text(current_gtin)
    parts = sku.split()
    if len(parts) == 2 and re.fullmatch(r"\d{8}|\d{12,14}", parts[1]):
        if not gtin:
            gtin = parts[1]
        sku = parts[0]
    return sku, gtin


def extract_description(html: str, product_block: dict[str, Any]) -> str:
    description = product_block.get("description")
    if isinstance(description, str) and clean_text(description):
        return strip_tags(description)

    meta_match = re.search(r'<meta[^>]+name="description"[^>]+content="([^"]*)"', html, re.IGNORECASE)
    if meta_match:
        return clean_text(meta_match.group(1))

    desc_match = re.search(
        r'<div[^>]+class="[^"]*productView-description[^"]*"[^>]*>(.*?)</article>',
        html,
        re.DOTALL | re.IGNORECASE,
    )
    if desc_match:
        return strip_tags(desc_match.group(1))
    return ""


def transform_product(url: str, html: str) -> dict[str, Any] | None:
    blocks = parse_jsonld_script(html)
    flat_blocks = flatten_jsonld(blocks)
    product_block = extract_product_block(flat_blocks)
    bcdata = extract_bcdata(html)
    attrs = bcdata.get("product_attributes", {}) if isinstance(bcdata, dict) else {}

    title = first_non_empty(
        product_block.get("name") if isinstance(product_block, dict) else "",
        re.search(r"<h1[^>]*class=\"[^\"]*productView-title[^\"]*\"[^>]*>(.*?)</h1>", html, re.DOTALL | re.IGNORECASE).group(1)
        if re.search(r"<h1[^>]*class=\"[^\"]*productView-title[^\"]*\"[^>]*>(.*?)</h1>", html, re.DOTALL | re.IGNORECASE)
        else "",
    )
    if not title:
        return None

    offers_value = product_block.get("offers") if isinstance(product_block, dict) else {}
    if isinstance(offers_value, list):
        offer = offers_value[0] if offers_value else {}
    else:
        offer = offers_value
    if not isinstance(offer, dict):
        offer = {}

    product_id_match = re.search(r'window\.stencilBootstrap\("product", "\{\\\"productId\\\":(\d+)', html)
    product_id = product_id_match.group(1) if product_id_match else ""

    sku = first_non_empty(
        attrs.get("sku") if isinstance(attrs, dict) else "",
        offer.get("sku") if isinstance(offer, dict) else "",
        product_block.get("sku") if isinstance(product_block, dict) else "",
        re.search(r'data-product-sku>([^<]+)<', html).group(1) if re.search(r'data-product-sku>([^<]+)<', html) else "",
        f"{MERCHANT_ID}_{product_id}" if product_id else "",
    )
    if not sku:
        return None

    price = (
        parse_price(offer.get("price"))
        or parse_price(((attrs.get("price") or {}).get("without_tax") or {}).get("value") if isinstance(attrs, dict) else None)
        or parse_price(re.search(r'<meta property="product:price:amount" content="([^"]+)"', html).group(1)
                       if re.search(r'<meta property="product:price:amount" content="([^"]+)"', html) else None)
    )
    if price is None or price <= 0:
        return None

    brand = ""
    brand_value = product_block.get("brand") if isinstance(product_block, dict) else None
    if isinstance(brand_value, dict):
        brand = clean_text(str(brand_value.get("name") or ""))
    elif isinstance(brand_value, str):
        brand = clean_text(brand_value)
    if not brand:
        brand_match = re.search(r'<h2[^>]*class="[^"]*productView-brand[^"]*"[^>]*>.*?<a[^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE)
        if brand_match:
            brand = strip_tags(brand_match.group(1))

    images: list[str] = []
    image_value = product_block.get("image") if isinstance(product_block, dict) else None
    if isinstance(image_value, list):
        images = [img for img in image_value if isinstance(img, str) and img.startswith("http")]
    elif isinstance(image_value, str) and image_value.startswith("http"):
        images = [image_value]
    if not images:
        og_match = re.search(r'<meta property="og:image" content="([^"]+)"', html, re.IGNORECASE)
        if og_match:
            images = [og_match.group(1)]

    breadcrumbs = extract_breadcrumbs(flat_blocks)
    gtin = ""
    for key in ("gtin14", "gtin13", "gtin12", "gtin8", "gtin"):
        value = product_block.get(key) if isinstance(product_block, dict) else None
        if isinstance(value, str) and value.strip():
            gtin = value.strip()
            break

    mpn = first_non_empty(
        product_block.get("mpn") if isinstance(product_block, dict) else "",
        attrs.get("mpn") if isinstance(attrs, dict) else "",
    )
    sku, gtin = normalize_sku_and_gtin(sku, gtin)

    if breadcrumbs and clean_text(breadcrumbs[-1]).lower() == title.lower():
        breadcrumbs = breadcrumbs[:-1]
    category = breadcrumbs[-1] if breadcrumbs else ""

    availability = str(offer.get("availability") or "")
    in_stock = "InStock" in availability if availability else bool(attrs.get("instock")) if isinstance(attrs, dict) else True
    is_active = bool(attrs.get("purchasable", True)) if isinstance(attrs, dict) else True

    metadata: dict[str, Any] = {
        "source_type": "bigcommerce_sitemap_jsonld",
        "source_url": SITEMAP_URL,
    }
    if product_id:
        metadata["product_id"] = product_id

    original_price = parse_price(offer.get("highPrice")) if isinstance(offer, dict) else None
    if original_price and original_price > price:
        metadata["original_price"] = original_price

    return {
        "sku": sku,
        "merchant_id": MERCHANT_ID,
        "title": title,
        "description": extract_description(html, product_block),
        "price": price,
        "currency": first_non_empty(offer.get("priceCurrency") if isinstance(offer, dict) else "", "SGD"),
        "url": url,
        "image_url": images[0] if images else "",
        "category": category,
        "category_path": breadcrumbs,
        "brand": brand,
        "is_active": is_active,
        "is_available": in_stock,
        "in_stock": in_stock,
        "availability": "in_stock" if in_stock else "out_of_stock",
        "country_code": "SG",
        "region": "sg",
        "gtin": gtin or None,
        "mpn": mpn or None,
        "metadata": metadata,
    }


class SelffixScraper:
    def __init__(self, output_dir: Path, concurrency: int, limit: int):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.outfile = self.output_dir / f"products_{time.strftime('%Y%m%d_%H%M%S')}.jsonl"
        self.concurrency = concurrency
        self.limit = limit
        self.client = httpx.AsyncClient(timeout=30.0, headers=HEADERS, follow_redirects=True)
        self.write_lock = asyncio.Lock()
        self.seen_skus: dict[str, str] = {}
        self.total_scraped = 0
        self.total_failed = 0

    async def close(self) -> None:
        await self.client.aclose()

    async def fetch_sitemap_urls(self) -> list[str]:
        resp = await self.client.get(SITEMAP_URL)
        resp.raise_for_status()
        urls = re.findall(r"<loc>(https://www\.selffix\.com/[^<]+)</loc>", resp.text)
        seen: set[str] = set()
        ordered: list[str] = []
        for url in urls:
            if url not in seen:
                seen.add(url)
                ordered.append(url)
        if self.limit > 0:
            return ordered[: self.limit]
        return ordered

    async def fetch_product(self, url: str, semaphore: asyncio.Semaphore) -> dict[str, Any] | None:
        async with semaphore:
            for attempt in range(3):
                try:
                    resp = await self.client.get(url)
                    resp.raise_for_status()
                    product = transform_product(url, resp.text)
                    if product is None:
                        self.total_failed += 1
                    return product
                except Exception as exc:
                    if attempt < 2:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        self.total_failed += 1
                        log.request_failed(url, attempt, str(exc))
                        return None

    async def append_product(self, product: dict[str, Any]) -> None:
        async with self.write_lock:
            sku = str(product.get("sku") or "").strip()
            url = str(product.get("url") or "").strip()
            existing_url = self.seen_skus.get(sku)
            if sku and existing_url and existing_url != url:
                product_id = str(((product.get("metadata") or {}).get("product_id")) or "").strip()
                if product_id:
                    product["sku"] = f"{sku}_{product_id}"
            if product.get("sku"):
                self.seen_skus[str(product["sku"])] = url
            with self.outfile.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(product, ensure_ascii=False) + "\n")

    async def run(self) -> Path:
        urls = await self.fetch_sitemap_urls()
        log.progress(f"Found {len(urls)} Selffix product URLs from sitemap")

        semaphore = asyncio.Semaphore(self.concurrency)
        tasks = [self.fetch_product(url, semaphore) for url in urls]
        for future in asyncio.as_completed(tasks):
            product = await future
            if not product:
                continue
            await self.append_product(product)
            self.total_scraped += 1
            if self.total_scraped % 100 == 0:
                log.progress(f"Scraped {self.total_scraped} products")

        log.progress(
            f"Finished Selffix scrape with {self.total_scraped} products and {self.total_failed} failures"
        )
        return self.outfile


async def async_main(args: argparse.Namespace) -> int:
    scraper = SelffixScraper(
        output_dir=Path(args.output_dir),
        concurrency=args.concurrency,
        limit=args.limit,
    )
    try:
        outfile = await scraper.run()
        print(str(outfile))
        return 0
    finally:
        await scraper.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrape Selffix SG products from the public BigCommerce sitemap")
    parser.add_argument("--output-dir", default=str(OUTPUT_DIR))
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--scrape-only", action="store_true")
    args = parser.parse_args()
    return asyncio.run(async_main(args))


if __name__ == "__main__":
    raise SystemExit(main())
