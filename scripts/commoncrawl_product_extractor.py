#!/usr/bin/env python3
"""Extract product data from CommonCrawl WARC files with JSON-LD Product/Offer schema.

Targets CommonCrawl monthly crawls (CC-MAIN-*) and extracts structured e-commerce data:
- JSON-LD Product/Offer/AggregateOffer schemas
- Merchant identity (domain/brand)
- Product attributes: title, price, currency, image, description, gtin, etc.

Outputs normalized NDJSON compatible with bulk_ingest.py.
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import logging
import re
import sys
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator, Iterable
from urllib.parse import urlparse, urljoin

try:
    import warcio
    from warcio.archiveiterator import ArchiveIterator
except ImportError:
    warcio = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

logger = logging.getLogger(__name__)


@dataclass
class ProductRecord:
    """Normalized product extracted from CommonCrawl."""
    url: str
    merchant_domain: str
    title: str | None = None
    price: str | None = None
    currency: str | None = None
    description: str | None = None
    image_url: str | None = None
    brand: str | None = None
    gtin: str | None = None
    product_type: str | None = None
    source: str = "commoncrawl_warc"
    extracted_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dict, excluding None values."""
        result = asdict(self)
        if not self.extracted_at:
            result["extracted_at"] = datetime.now(timezone.utc).isoformat()
        return {k: v for k, v in result.items() if v is not None}


def extract_json_ld(html_content: str) -> list[dict[str, Any]]:
    """Extract all JSON-LD objects from HTML."""
    results = []
    pattern = r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>'

    for match in re.finditer(pattern, html_content, re.DOTALL | re.IGNORECASE):
        try:
            obj = json.loads(match.group(1))
            results.append(obj)
        except (json.JSONDecodeError, ValueError):
            pass

    return results


def is_product_schema(obj: Any) -> bool:
    """Check if object is a Product or related e-commerce schema."""
    if not isinstance(obj, dict):
        return False

    schema_type = obj.get("@type", "")
    if isinstance(schema_type, str):
        return any(t in schema_type for t in ("Product", "Offer", "AggregateOffer"))
    elif isinstance(schema_type, list):
        return any(any(t in str(s) for t in ("Product", "Offer", "AggregateOffer")) for s in schema_type)

    return False


def flatten_schema(obj: Any) -> list[dict[str, Any]]:
    """Flatten nested schema objects (e.g., offers, aggregateOffer)."""
    results = []

    if not isinstance(obj, dict):
        return results

    # If this is a Product, extract main fields and nested offers
    if "Product" in str(obj.get("@type", "")):
        results.append(obj)

        # Check for nested offers
        for key in ("offers", "aggregateOffer"):
            offer = obj.get(key)
            if isinstance(offer, dict):
                results.append(offer)
            elif isinstance(offer, list):
                results.extend([o for o in offer if isinstance(o, dict)])

    # If this is an Offer, include it
    elif any(t in str(obj.get("@type", "")) for t in ("Offer", "AggregateOffer")):
        results.append(obj)

    return results


def extract_product_fields(schema_obj: dict[str, Any], page_url: str) -> ProductRecord | None:
    """Extract normalized product fields from a schema object."""
    # Extract title
    title = schema_obj.get("name") or schema_obj.get("productName")
    if not title:
        return None  # Required field

    # Extract price (handle multiple formats)
    price = None
    currency = None

    # Direct price field
    if "price" in schema_obj:
        price = str(schema_obj["price"])

    # Offer-level price
    if not price and "priceCurrency" in schema_obj:
        price = schema_obj.get("price")

    # AggregateOffer price range
    if not price:
        for price_key in ("lowPrice", "price", "priceLow"):
            if price_key in schema_obj:
                price = str(schema_obj[price_key])
                break

    # Currency
    currency = schema_obj.get("priceCurrency")

    # Extract other fields
    description = schema_obj.get("description")
    image_url = schema_obj.get("image")
    if isinstance(image_url, list) and image_url:
        image_url = image_url[0]
    if isinstance(image_url, dict):
        image_url = image_url.get("url", image_url.get("contentUrl"))

    brand = schema_obj.get("brand")
    if isinstance(brand, dict):
        brand = brand.get("name")

    gtin = schema_obj.get("gtin") or schema_obj.get("gtin13") or schema_obj.get("gtin12") or schema_obj.get("sku")

    # Extract merchant domain from URL
    parsed = urlparse(page_url)
    merchant_domain = parsed.netloc.lower()
    if merchant_domain.startswith("www."):
        merchant_domain = merchant_domain[4:]

    # Absolutize image URL if needed
    if image_url and not image_url.startswith("http"):
        image_url = urljoin(page_url, image_url)

    return ProductRecord(
        url=page_url,
        merchant_domain=merchant_domain,
        title=str(title) if title else None,
        price=price,
        currency=currency,
        description=str(description) if description else None,
        image_url=image_url,
        brand=str(brand) if brand else None,
        gtin=str(gtin) if gtin else None,
    )


def process_warc_record(record: Any, base_url: str | None = None) -> Generator[ProductRecord, None, None]:
    """Process a single WARC record and yield extracted products."""
    try:
        if record.rec_type != "response":
            return

        # Get HTTP headers
        if not hasattr(record, "http_headers") or record.http_headers is None:
            return

        content_type = record.http_headers.get_header("Content-Type", "").lower()
        if "text/html" not in content_type:
            return

        # Extract page URL
        page_url = record.rec_headers.get_header("WARC-Target-URI")
        if not page_url:
            return

        # Read and decompress content
        try:
            raw_content = record.content_stream().read()
            if record.http_headers.get_header("Content-Encoding") == "gzip":
                raw_content = gzip.decompress(raw_content)
            html_content = raw_content.decode("utf-8", errors="ignore")
        except (OSError, UnicodeDecodeError):
            return

        # Extract JSON-LD objects
        json_ld_objects = extract_json_ld(html_content)

        # Process each schema object
        products_found = 0
        for obj in json_ld_objects:
            if is_product_schema(obj):
                # Flatten nested offers
                flattened = flatten_schema(obj)
                for schema_obj in flattened:
                    product = extract_product_fields(schema_obj, page_url)
                    if product:
                        yield product
                        products_found += 1

        if products_found > 0:
            logger.debug(f"Extracted {products_found} products from {page_url}")

    except Exception as e:
        logger.debug(f"Error processing WARC record: {e}")


def download_warc_file(warc_url: str, output_path: Path, timeout: int = 120) -> bool:
    """Download a WARC file from CommonCrawl S3."""
    try:
        logger.info(f"Downloading {warc_url}")
        req = urllib.request.Request(warc_url, headers={"User-Agent": "buywhere-cc-extractor/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            with output_path.open("wb") as f:
                while True:
                    chunk = response.read(8192)
                    if not chunk:
                        break
                    f.write(chunk)
        logger.info(f"Downloaded to {output_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to download {warc_url}: {e}")
        return False


def fetch_commoncrawl_index(collection_id: str) -> list[str] | None:
    """Fetch WARC file paths from CommonCrawl CDX for a collection."""
    try:
        url = f"https://index.commoncrawl.org/{collection_id}-index?output=json&fl=warc"
        req = urllib.request.Request(url, headers={"User-Agent": "buywhere-cc-extractor/1.0"})
        with urllib.request.urlopen(req, timeout=60) as response:
            lines = response.read().decode("utf-8").splitlines()

        warc_paths = []
        for line in lines:
            try:
                obj = json.loads(line)
                if "warc" in obj:
                    warc_paths.append(obj["warc"])
            except json.JSONDecodeError:
                pass

        return list(set(warc_paths))  # Deduplicate
    except Exception as e:
        logger.error(f"Failed to fetch CDX index for {collection_id}: {e}")
        return None


def extract_from_warc_file(warc_path: Path | str) -> Generator[ProductRecord, None, None]:
    """Extract products from a local WARC file."""
    if warcio is None:
        logger.error("warcio library not installed. Install with: pip install warcio")
        return

    warc_path = Path(warc_path)
    if not warc_path.exists():
        logger.error(f"WARC file not found: {warc_path}")
        return

    try:
        with open(warc_path, "rb") as f:
            for record in ArchiveIterator(f):
                yield from process_warc_record(record)
    except Exception as e:
        logger.error(f"Error reading WARC file {warc_path}: {e}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--collection",
        default="CC-MAIN-2025-18",
        help="CommonCrawl collection ID (e.g., CC-MAIN-2025-18)"
    )
    parser.add_argument(
        "--warc-file",
        help="Path to local WARC file to process (skips download)"
    )
    parser.add_argument(
        "--warc-url",
        help="Direct URL to a WARC file on CommonCrawl S3"
    )
    parser.add_argument(
        "--output-dir",
        default="data/extracted_products",
        help="Output directory for NDJSON files"
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Limit number of WARC files to process"
    )
    parser.add_argument(
        "--download-dir",
        default="/tmp/commoncrawl_warc",
        help="Temporary directory for downloaded WARC files"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging"
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    log_level = logging.DEBUG if args.debug else logging.INFO
    logging.basicConfig(level=log_level, format="%(levelname)s: %(message)s")

    if warcio is None:
        print("ERROR: warcio library required. Install with: pip install warcio", file=sys.stderr)
        return 1

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    all_products = []

    # Process single WARC file if provided
    if args.warc_file:
        logger.info(f"Processing WARC file: {args.warc_file}")
        for product in extract_from_warc_file(args.warc_file):
            all_products.append(product)

    # Download and process from URL
    elif args.warc_url:
        download_dir = Path(args.download_dir)
        download_dir.mkdir(parents=True, exist_ok=True)

        filename = args.warc_url.split("/")[-1]
        local_path = download_dir / filename

        if download_warc_file(args.warc_url, local_path):
            for product in extract_from_warc_file(local_path):
                all_products.append(product)

    # Fetch collection index and process
    else:
        logger.info(f"Fetching CDX index for {args.collection}")
        warc_paths = fetch_commoncrawl_index(args.collection)

        if not warc_paths:
            logger.warning(f"No WARC files found in collection {args.collection}")
            return 1

        if args.limit:
            warc_paths = warc_paths[:args.limit]

        logger.info(f"Found {len(warc_paths)} WARC files, processing {len(warc_paths[:args.limit or None])}")

        download_dir = Path(args.download_dir)
        download_dir.mkdir(parents=True, exist_ok=True)

        for i, warc_path in enumerate(warc_paths):
            warc_url = f"https://data.commoncrawl.org/{warc_path}"
            filename = warc_path.split("/")[-1]
            local_path = download_dir / filename

            logger.info(f"[{i+1}/{len(warc_paths)}] Processing {filename}")

            if not local_path.exists():
                if not download_warc_file(warc_url, local_path):
                    continue

            for product in extract_from_warc_file(local_path):
                all_products.append(product)

            if len(all_products) % 100 == 0:
                logger.info(f"Extracted {len(all_products)} products so far")

    # Write output
    if all_products:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        output_file = output_dir / f"commoncrawl_products_{timestamp}.ndjson"

        with output_file.open("w", encoding="utf-8") as f:
            for product in all_products:
                f.write(json.dumps(product.to_dict()) + "\n")

        logger.info(f"Wrote {len(all_products)} products to {output_file}")

        # Print summary
        summary = {
            "timestamp": timestamp,
            "collection": args.collection,
            "total_products": len(all_products),
            "unique_merchants": len(set(p.merchant_domain for p in all_products)),
            "output_file": str(output_file),
        }
        print(json.dumps(summary, indent=2))
        return 0
    else:
        logger.warning("No products extracted")
        return 2


if __name__ == "__main__":
    sys.exit(main())
