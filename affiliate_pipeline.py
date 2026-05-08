#!/usr/bin/env python3
"""
Affiliate feed → NDJSON ingestion pipeline.

Parses affiliate network product feeds (CJ, ShareASale, Impact Radius)
and converts them to BuyWhere catalog-compatible NDJSON format.

Usage:
    python affiliate_pipeline.py --list
    python affiliate_pipeline.py --cj /path/to/cj_feed.csv
    python affiliate_pipeline.py --shareasale /path/to/shareasale_feed.tsv
    python affiliate_pipeline.py --impact /path/to/impact_feed.xml
    python affiliate_pipeline.py --cj-dir /path/to/cj/ --shareasale-dir /path/to/ss/ --impact-dir /path/to/impact/
"""
import argparse
import csv
import json
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class AffiliateProduct:
    merchant_id: str
    merchant_name: str
    network: str
    sku: str
    title: str
    description: str
    brand: str
    price: str
    currency: str
    original_price: str
    url: str
    image_url: str
    category: str
    gtin: str
    mpn: str
    is_active: bool


def _base_record(prod: AffiliateProduct) -> dict:
    return {
        "sku": prod.sku,
        "title": prod.title,
        "description": prod.description,
        "brand": prod.brand,
        "price": prod.price,
        "currency": prod.currency or "SGD",
        "original_price": prod.original_price,
        "url": prod.url,
        "image_url": prod.image_url,
        "merchant_id": prod.merchant_id,
        "merchant_name": prod.merchant_name,
        "category": prod.category,
        "gtin": prod.gtin or None,
        "mpn": prod.mpn or None,
        "is_active": prod.is_active,
        "metadata": {
            "affiliate_network": prod.network,
            "product_id": prod.sku,
        }
    }


# ─────────────────────────────────────────────────────────────────────────────
# CJ Affiliate (CSV) Parser
# CJ feeds use a header row; we map by column name for robustness.
# Common CJ columns: advertiser-name, advertiser-id, sku, manufacturer-name,
#   manufacturer-sku, product-name, description, price, buy-url, image-url,
#   category, subcategory, brand, original-price, currency, in-stock, upc
# ─────────────────────────────────────────────────────────────────────────────

_CJ_IN_STOCK_TRUE = {"in stock", "yes", "true", "1", "available"}


def parse_cj_feed(filepath: Path) -> list[dict]:
    records = []
    with open(filepath, encoding="latin-1") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sku = row.get("sku", "").strip()
            if not sku:
                continue
            price_str = row.get("price", "").strip()
            if not price_str or price_str.lower() in ("n/a", ""):
                continue
            advertiser_id = row.get("advertiser-id", "").strip()
            in_stock = row.get("in-stock", "in stock").strip().lower()
            records.append(_base_record(AffiliateProduct(
                merchant_id=f"cj_{advertiser_id}" if advertiser_id else f"cj_{sku[:20]}",
                merchant_name=row.get("advertiser-name", "").strip(),
                network="cj",
                sku=sku,
                title=row.get("product-name", "").strip(),
                description=row.get("description", "").strip(),
                brand=row.get("brand", "").strip() or row.get("manufacturer-name", "").strip(),
                price=price_str,
                currency=row.get("currency", "").strip() or "USD",
                original_price=row.get("original-price", "").strip(),
                url=row.get("buy-url", "").strip(),
                image_url=row.get("image-url", "").strip(),
                category=row.get("category", "").strip(),
                gtin=row.get("upc", "").strip(),
                mpn=row.get("manufacturer-sku", "").strip(),
                is_active=in_stock in _CJ_IN_STOCK_TRUE,
            )))
    return records


# ─────────────────────────────────────────────────────────────────────────────
# ShareASale (TSV) Parser
# ShareASale fields (pipe-delimited header, tab-delimited data):
#   SKU|ProductName|Manufacturer|Brand|Price|ProductURL|ImageURL|
#   Category|SubCategory|Description|Inventory|InStock|UPC|MFN
# ─────────────────────────────────────────────────────────────────────────────

SS_REQUIRED = {"SKU", "ProductName", "Price", "ProductURL"}


def parse_shareasale_feed(filepath: Path) -> list[dict]:
    records = []
    with open(filepath, encoding="latin-1") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            sku = row.get("SKU", "").strip()
            if not sku:
                continue
            price_str = row.get("Price", "").strip()
            if not price_str or price_str.lower() in ("n/a", ""):
                continue
            in_stock_val = row.get("InStock", "yes").strip().lower()
            merchant_id = row.get("MFN", "").strip() or row.get("SKU", "")[:20]
            records.append(_base_record(AffiliateProduct(
                merchant_id=f"ss_{merchant_id}",
                merchant_name=row.get("Manufacturer", merchant_id).strip(),
                network="shareasale",
                sku=sku,
                title=row.get("ProductName", "").strip(),
                description=row.get("Description", "").strip(),
                brand=row.get("Brand", "").strip(),
                price=price_str,
                currency="USD",
                original_price=row.get("OriginalPrice", "").strip(),
                url=row.get("ProductURL", "").strip(),
                image_url=row.get("ImageURL", "").strip(),
                category=row.get("Category", "").strip(),
                gtin=row.get("UPC", "").strip(),
                mpn=row.get("ManufacturerSKU", "").strip(),
                is_active=in_stock_val not in ("no", "false", "out of stock"),
            )))
    return records


# ─────────────────────────────────────────────────────────────────────────────
# Impact Radius (XML) Parser
# IR XML format: <ProductFeed><Products><Product>...</Product></Products></ProductFeed>
# Key elements: SKU, Name, Description, Brand, Price, Currency,
#               BuyURL, ImageURL, Category, Subcategory, UPC, MPN, InStock
# ─────────────────────────────────────────────────────────────────────────────

IR_NS = {}


def _text(el: ET.Element, tag: str) -> str:
    child = el.find(tag, IR_NS)
    return child.text.strip() if child is not None and child.text else ""


def parse_impact_feed(filepath: Path) -> list[dict]:
    records = []
    tree = ET.parse(filepath)
    root = tree.getroot()
    for product in root.findall(".//Product", IR_NS):
        sku = _text(product, "SKU").strip()
        if not sku:
            continue
        price_str = _text(product, "Price").strip()
        if not price_str or price_str.lower() in ("n/a", ""):
            continue
        in_stock_val = _text(product, "InStock").strip().lower()
        merchant_name = _text(product, "AdvertiserName") or _text(product, "MerchantName")
        records.append(_base_record(AffiliateProduct(
            merchant_id=f"ir_{_text(product, 'AdvertiserID').strip()}",
            merchant_name=merchant_name.strip(),
            network="impact_radius",
            sku=sku,
            title=_text(product, "Name").strip(),
            description=_text(product, "Description").strip(),
            brand=_text(product, "Brand").strip(),
            price=price_str,
            currency=_text(product, "Currency") or "USD",
            original_price=_text(product, "OriginalPrice").strip(),
            url=_text(product, "BuyURL").strip(),
            image_url=_text(product, "ImageURL").strip(),
            category=_text(product, "Category").strip(),
            gtin=_text(product, "UPC").strip(),
            mpn=_text(product, "MPN").strip(),
            is_active=in_stock_val not in ("no", "false", "out of stock"),
        )))
    return records


# ─────────────────────────────────────────────────────────────────────────────
# Output
# ─────────────────────────────────────────────────────────────────────────────

PLATFORM_BY_NETWORK = {
    "cj": "cj_affiliate",
    "shareasale": "shareasale_affiliate",
    "impact_radius": "impact_affiliate",
}

OUTPUT_DIR = Path("/home/paperclip/buywhere-api/data/normalized")


def write_ndjson(records: list[dict], network: str, out_dir: Path = OUTPUT_DIR) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    platform = PLATFORM_BY_NETWORK.get(network, f"{network}_affiliate")
    out_path = out_dir / f"{platform}_normalized.ndjson"
    with open(out_path, "w") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return out_path


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def list_networks():
    print("Supported affiliate networks:")
    for name, platform in PLATFORM_BY_NETWORK.items():
        print(f"  {name} -> platform={platform}")


def main():
    parser = argparse.ArgumentParser(description="Affiliate feed → NDJSON pipeline")
    parser.add_argument("--list", action="store_true", help="List supported networks and exit")
    parser.add_argument("--cj", type=Path, help="Path to CJ CSV feed")
    parser.add_argument("--shareasale", type=Path, help="Path to ShareASale TSV feed")
    parser.add_argument("--impact", type=Path, help="Path to Impact Radius XML feed")
    parser.add_argument("--cj-dir", type=Path, help="Directory containing CJ CSV feeds")
    parser.add_argument("--shareasale-dir", type=Path, help="Directory containing ShareASale TSV feeds")
    parser.add_argument("--impact-dir", type=Path, help="Directory containing Impact Radius XML feeds")
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR, help="Output directory for NDJSON")
    args = parser.parse_args()

    if args.list:
        list_networks()
        return

    total_records = 0

    def process(path: Path, parser_fn, network: str):
        nonlocal total_records
        print(f"Parsing {path} ({network})...", flush=True)
        records = parser_fn(path)
        out_path = write_ndjson(records, network, args.output_dir)
        print(f"  -> {len(records)} records -> {out_path}", flush=True)
        total_records += len(records)

    if args.cj:
        process(args.cj, parse_cj_feed, "cj")
    if args.shareasale:
        process(args.shareasale, parse_shareasale_feed, "shareasale")
    if args.impact:
        process(args.impact, parse_impact_feed, "impact_radius")

    if args.cj_dir:
        for path in sorted(args.cj_dir.glob("*.csv")):
            process(path, parse_cj_feed, "cj")
    if args.shareasale_dir:
        for path in sorted(args.shareasale_dir.glob("*.tsv")):
            process(path, parse_shareasale_feed, "shareasale")
    if args.impact_dir:
        for path in sorted(args.impact_dir.glob("*.xml")):
            process(path, parse_impact_feed, "impact_radius")

    print(f"\nTotal: {total_records} records written")


if __name__ == "__main__":
    main()
