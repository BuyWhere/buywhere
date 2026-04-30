#!/usr/bin/env python3
"""
Product Duplicate Merger

Finds products with >90% title similarity + same brand from different platforms.
Marks duplicates with a canonical_id pointing to the cheapest matching product.

Usage:
    python merge_duplicates.py [--dry-run] [--min-similarity 0.90]
    python merge_duplicates.py --dry-run
"""

import argparse
import os
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

from sqlalchemy import create_engine, text

# Use DATABASE_URL env var if set (from .env or CI), otherwise fall back to
# the catalog DB host used by the ingest pipeline.
_raw_url = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://buywhere:buywhere@172.18.0.6:5432/buywhere",
)
# merge_duplicates uses the synchronous driver
if _raw_url.startswith("postgresql+asyncpg://"):
    DATABASE_URL = _raw_url.replace("postgresql+asyncpg://", "postgresql://")
elif _raw_url.startswith("postgres://"):
    DATABASE_URL = _raw_url.replace("postgres://", "postgresql://")
else:
    DATABASE_URL = _raw_url

MIN_TITLE_SIMILARITY = 0.90
BLOCK_SIZE_THRESHOLD = 500


@dataclass
class ProductRow:
    """Lightweight representation of a products table row (new schema)."""
    id: str          # UUID
    name: str
    brand: str | None
    platform: str
    product_url: str
    price: float


@dataclass
class MergeGroup:
    canonical_id: str
    products: list = field(default_factory=list)
    sources: list = field(default_factory=list)
    source_urls: list = field(default_factory=list)
    merged_count: int = 0


def normalize_title(title: str) -> str:
    if not title:
        return ""
    t = title.lower().strip()
    t = re.sub(r"[^\w\s]", "", t)
    t = re.sub(r"\s+", " ", t)
    return t


def get_block_key(product: ProductRow) -> str:
    norm = normalize_title(product.name)
    first_word = norm.split()[0] if norm else ""
    brand = (product.brand or "").lower().strip()
    return f"{first_word}_{brand}"


def title_similarity(t1: str, t2: str) -> float:
    return SequenceMatcher(None, t1, t2).ratio()


def find_duplicate_groups(
    products: list[ProductRow], min_similarity: float = MIN_TITLE_SIMILARITY
) -> list[MergeGroup]:
    block_map: dict[str, list[ProductRow]] = defaultdict(list)
    for p in products:
        block_map[get_block_key(p)].append(p)

    merge_groups: list[MergeGroup] = []
    processed_ids: set[str] = set()

    for block_products in block_map.values():
        if len(block_products) < 2:
            continue
        if len(block_products) > BLOCK_SIZE_THRESHOLD:
            groups = _process_large_block(block_products, min_similarity, processed_ids)
        else:
            groups = _process_small_block(block_products, min_similarity, processed_ids)
        merge_groups.extend(groups)

    return merge_groups


def _process_large_block(
    block_products: list[ProductRow], min_similarity: float, processed_ids: set[str]
) -> list[MergeGroup]:
    title_map: dict[str, list[ProductRow]] = defaultdict(list)
    for p in block_products:
        if p.id in processed_ids:
            continue
        title_map[normalize_title(p.name)].append(p)

    groups = []
    for group in title_map.values():
        if len(group) < 2:
            continue
        platforms = set(p.platform for p in group)
        if len(platforms) < 2:
            continue
        for p in group:
            processed_ids.add(p.id)
        groups.append(_build_merge_group(group))
    return groups


def _process_small_block(
    block_products: list[ProductRow], min_similarity: float, processed_ids: set[str]
) -> list[MergeGroup]:
    groups = []

    for i, p1 in enumerate(block_products):
        if p1.id in processed_ids:
            continue

        group_products = [p1]
        processed_ids.add(p1.id)
        p1_norm = normalize_title(p1.name)
        p1_brand = (p1.brand or "").lower().strip()

        for p2 in block_products[i + 1:]:
            if p2.id in processed_ids:
                continue
            p2_brand = (p2.brand or "").lower().strip()
            if p1_brand and p2_brand and p1_brand != p2_brand:
                continue
            p2_norm = normalize_title(p2.name)
            if title_similarity(p1_norm, p2_norm) >= min_similarity:
                group_products.append(p2)
                processed_ids.add(p2.id)

        platforms = set(p.platform for p in group_products)
        if len(platforms) < 2:
            continue
        groups.append(_build_merge_group(group_products))

    return groups


def _build_merge_group(products: list[ProductRow]) -> MergeGroup:
    canonical = min(products, key=lambda p: (p.price, p.id))
    group = MergeGroup(canonical_id=canonical.id)
    group.products = products
    group.sources = sorted(set(p.platform for p in products))
    group.source_urls = [(p.platform, p.product_url) for p in products]
    group.merged_count = len(products) - 1
    return group


def ensure_canonical_id_column(conn) -> bool:
    """Add canonical_id column to products table if absent. Returns True on success."""
    try:
        conn.execute(text(
            "ALTER TABLE products ADD COLUMN IF NOT EXISTS canonical_id TEXT"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_products_canonical_id ON products(canonical_id)"
        ))
        return True
    except Exception as e:
        print(f"  Warning: could not add canonical_id column: {e}", file=sys.stderr)
        return False


def merge_in_db(engine, merge_groups: list[MergeGroup], dry_run: bool = False) -> dict:
    stats = {
        "groups_found": len(merge_groups),
        "products_updated": 0,
        "canonicals_merged": 0,
    }

    if dry_run:
        print(f"\n[DRY RUN] Would process {len(merge_groups)} merge groups")
        return stats

    with engine.begin() as conn:
        ensure_canonical_id_column(conn)

    with engine.begin() as conn:
        for mg in merge_groups:
            duplicate_ids = [p.id for p in mg.products if p.id != mg.canonical_id]
            if not duplicate_ids:
                continue

            placeholders = ", ".join(f":id_{i}" for i in range(len(duplicate_ids)))
            params = {"canonical_id": mg.canonical_id}
            params.update({f"id_{i}": did for i, did in enumerate(duplicate_ids)})

            conn.execute(
                text(f"UPDATE products SET canonical_id = :canonical_id WHERE id IN ({placeholders})"),
                params,
            )
            stats["products_updated"] += len(duplicate_ids)
            stats["canonicals_merged"] += 1

    return stats


def generate_report(
    merge_groups: list[MergeGroup], stats: dict, min_similarity: float, elapsed: float
) -> str:
    total_duplicates = sum(mg.merged_count for mg in merge_groups)
    sources_affected: set[str] = set()
    for mg in merge_groups:
        sources_affected.update(mg.sources)

    lines = [
        "# Product Duplicate Merge Report",
        "",
        f"**Generated:** {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}",
        f"**Min Similarity Threshold:** {min_similarity:.0%}",
        "",
        "## Summary",
        "",
        f"- Merge groups found: **{stats['groups_found']}**",
        f"- Total duplicates merged: **{total_duplicates}**",
        f"- Canonical products updated: **{stats.get('canonicals_merged', 0)}**",
        f"- Products updated in DB: **{stats.get('products_updated', 0)}**",
        f"- Sources affected: **{', '.join(sorted(sources_affected))}**",
        f"- Elapsed time: **{elapsed:.1f}s**",
        "",
        "## Merge Groups",
        "",
    ]

    for i, mg in enumerate(merge_groups, 1):
        canonical = next((p for p in mg.products if p.id == mg.canonical_id), mg.products[0])
        lines.append(f"### Group {i}")
        lines.append(f"- Canonical Product ID: `{mg.canonical_id}`")
        lines.append(f"- Sources: {', '.join(mg.sources)}")
        lines.append(f"- Duplicates merged: {mg.merged_count}")
        lines.append(f"- Canonical title: {canonical.name}")
        lines.append(f"- Canonical price: {canonical.price}")
        lines.append("")
        lines.append("| Product ID | Platform | Name | Price |")
        lines.append("|------------|----------|------|-------|")
        for p in mg.products:
            lines.append(f"| {p.id} | {p.platform} | {p.name[:50]} | {p.price} |")
        lines.append("")

    return "\n".join(lines)


def fetch_products(engine) -> list[ProductRow]:
    """Fetch all products from the catalog DB using the current schema."""
    products = []
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT id, name, brand, platform, product_url, price FROM products")
        )
        for row in result:
            products.append(ProductRow(
                id=str(row.id),
                name=str(row.name or ""),
                brand=row.brand,
                platform=str(row.platform or ""),
                product_url=str(row.product_url or ""),
                price=float(row.price or 0),
            ))
    return products


def main():
    parser = argparse.ArgumentParser(description="Product Duplicate Merger")
    parser.add_argument("--dry-run", action="store_true",
                        help="Find duplicates without updating DB")
    parser.add_argument("--min-similarity", type=float, default=MIN_TITLE_SIMILARITY,
                        help=f"Minimum title similarity threshold (default: {MIN_TITLE_SIMILARITY})")
    args = parser.parse_args()

    engine = create_engine(DATABASE_URL, echo=False, pool_size=10, max_overflow=20)

    db_display = DATABASE_URL.split("@")[1] if "@" in DATABASE_URL else DATABASE_URL
    print("=" * 60)
    print("Product Duplicate Merger")
    print("=" * 60)
    print(f"Min similarity:  {args.min_similarity:.0%}")
    print(f"Dry run:         {args.dry_run}")
    print(f"Database:        {db_display}")
    print("=" * 60)

    start_fetch = time.time()
    products = fetch_products(engine)
    elapsed_fetch = time.time() - start_fetch
    print(f"\nFetched {len(products):,} products in {elapsed_fetch:.1f}s")

    print(f"\nFinding duplicate groups (similarity > {args.min_similarity:.0%})...")
    start_find = time.time()
    merge_groups = find_duplicate_groups(products, min_similarity=args.min_similarity)
    elapsed_find = time.time() - start_find
    print(f"Found {len(merge_groups)} merge groups in {elapsed_find:.1f}s")

    total_duplicates = sum(mg.merged_count for mg in merge_groups)
    print(f"Total duplicates to merge: {total_duplicates}")

    if not merge_groups:
        print("\nNo duplicate groups found.")
        engine.dispose()
        return

    start_merge = time.time()
    stats = merge_in_db(engine, merge_groups, dry_run=args.dry_run)
    elapsed_merge = time.time() - start_merge
    total_elapsed = elapsed_fetch + elapsed_find + elapsed_merge

    print(f"\nMerged in {elapsed_merge:.1f}s")

    report = generate_report(merge_groups, stats, args.min_similarity, total_elapsed)
    report_path = Path(__file__).parent.parent / "merge_report.md"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"\nReport written to: {report_path}")

    print("\n" + "=" * 60)
    print("MERGE SUMMARY")
    print("=" * 60)
    print(f"Merge groups:        {stats['groups_found']}")
    print(f"Duplicates merged:   {total_duplicates}")
    print(f"DB products updated: {stats.get('products_updated', 0)}")
    print(f"Total time:          {total_elapsed:.1f}s")
    print("=" * 60)

    engine.dispose()


if __name__ == "__main__":
    main()
