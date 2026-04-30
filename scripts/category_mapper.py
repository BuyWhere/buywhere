#!/usr/bin/env python3
"""Build a top-level category mapping across BuyWhere catalog files."""

from __future__ import annotations

import argparse
import html
import json
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


STANDARD_TAXONOMY = [
    "Electronics",
    "Fashion",
    "Groceries",
    "Home",
    "Beauty",
    "Sports",
    "Books",
    "Automotive",
    "Toys",
    "Health",
]

DEFAULT_INPUT_PATTERNS = [
    "catalog_sg_deduped.ndjson",
    "scripts/normalized/*.ndjson",
    "data/**/*.ndjson",
    "data/**/*.jsonl",
]

EXCLUDED_PATH_PARTS = {
    "venv",
    "__pycache__",
    "site-packages",
    "node_modules",
    "logs",
    "site",
}

EXACT_CATEGORY_RULES = {
    "electronics": "Electronics",
    "electronics accessories": "Electronics",
    "mobiles tablets": "Electronics",
    "extension sockets and chargers": "Electronics",
    "light bulbs and drop caps": "Electronics",
    "fashion": "Fashion",
    "fashion accessories": "Fashion",
    "fashion footwear": "Fashion",
    "shoes": "Fashion",
    "groceries": "Groceries",
    "premium groceries": "Groceries",
    "food": "Groceries",
    "cooking and baking needs": "Groceries",
    "beer wines and spirits": "Groceries",
    "breakfast and bakery": "Groceries",
    "canned preserved and soup": "Groceries",
    "cooking needs": "Groceries",
    "biscuits": "Groceries",
    "nuts and seeds": "Groceries",
    "bakery": "Groceries",
    "baking needs": "Groceries",
    "meat": "Groceries",
    "asian delicatessen": "Groceries",
    "delicatessen": "Groceries",
    "more great deals": "Groceries",
    "carton deals": "Groceries",
    "bulk and exclusive": "Groceries",
    "home": "Home",
    "home decor": "Home",
    "home living": "Home",
    "home kitchen": "Home",
    "kitchen dining": "Home",
    "lighting": "Home",
    "shelving storage": "Home",
    "rugs carpets": "Home",
    "desks and workstations": "Home",
    "beds mattresses": "Home",
    "sofas armchairs": "Home",
    "outdoor furniture": "Home",
    "dining furniture": "Home",
    "household supplies": "Home",
    "ottomans and benches": "Home",
    "kettles": "Home",
    "trash bins": "Home",
    "all cushions": "Home",
    "wall clocks": "Home",
    "floor mats": "Home",
    "cutlery": "Home",
    "ovens and toasters": "Home",
    "blenders and juicers": "Home",
    "knives": "Home",
    "loft and industrial": "Home",
    "placemats and coasters": "Home",
    "plants and flowers": "Home",
    "sideboards": "Home",
    "soap pumps": "Home",
    "wardrobe organisers": "Home",
    "baking trays and pans": "Home",
    "canvas and art prints": "Home",
    "curtain rods": "Home",
    "duvets quilts and blankets": "Home",
    "eclectic": "Home",
    "floor lamps": "Home",
    "japandi": "Home",
    "ladders and step stools": "Home",
    "pillows and bolsters": "Home",
    "serveware": "Home",
    "stand and floor fans": "Home",
    "beauty": "Beauty",
    "health beauty": "Beauty",
    "skin care": "Beauty",
    "sports outdoors": "Sports",
    "kids baby": "Toys",
    "books": "Books",
    "stationery": "Books",
    "automotive": "Automotive",
    "auto": "Automotive",
    "pet supplies": "Home",
}

KEYWORD_RULES = {
    "Electronics": [
        "electronic",
        "mobile",
        "tablet",
        "phone",
        "laptop",
        "computer",
        "gaming",
        "camera",
        "audio",
        "network",
        "smart home",
        "wearable",
        "tv",
        "monitor",
        "printer",
        "storage",
        "console",
    ],
    "Fashion": [
        "fashion",
        "shoe",
        "footwear",
        "bag",
        "luggage",
        "travel",
        "watch",
        "jewellery",
        "jewelry",
        "clothing",
        "dress",
        "shirt",
        "jeans",
        "outerwear",
        "accessories",
        "fragrance travel",
    ],
    "Groceries": [
        "grocery",
        "food",
        "beverage",
        "snack",
        "dairy",
        "grain",
        "spice",
        "instant food",
        "frozen food",
        "tea",
        "coffee",
        "condiment",
        "sauce",
        "rice",
    ],
    "Home": [
        "home",
        "decor",
        "furniture",
        "kitchen",
        "dining",
        "laundry",
        "bath",
        "storage",
        "lighting",
        "mattress",
        "sofa",
        "chair",
        "table",
        "bed",
        "appliance",
        "cookware",
        "knife",
        "towel",
        "rug",
        "shelving",
    ],
    "Beauty": [
        "beauty",
        "skincare",
        "makeup",
        "hair care",
        "haircare",
        "fragrance",
        "perfume",
        "cosmetic",
        "nail",
        "body care",
        "grooming",
        "oral care",
        "sun care",
    ],
    "Sports": [
        "sport",
        "fitness",
        "gym",
        "outdoor",
        "camping",
        "hiking",
        "cycling",
        "running",
        "exercise",
        "training",
        "yoga",
    ],
    "Books": [
        "book",
        "books",
        "notebook",
        "stationery",
        "magazine",
        "manga",
        "comic",
        "office supply",
        "paper",
        "pen",
    ],
    "Automotive": [
        "auto",
        "automotive",
        "car ",
        "vehicle",
        "motorcycle",
        "dash cam",
        "tyre",
        "tire",
        "car accessory",
        "car electronics",
        "car care",
        "motor oil",
    ],
    "Toys": [
        "toy",
        "kids",
        "baby",
        "nursery",
        "game",
        "puzzle",
        "lego",
        "doll",
        "play",
    ],
    "Health": [
        "health",
        "supplement",
        "medical",
        "first aid",
        "vitamin",
        "wellness",
        "medical device",
        "health drink",
        "protein",
        "collagen",
        "thermometer",
        "bp monitor",
    ],
}


@dataclass(frozen=True)
class CategoryMatch:
    mapped_category: str | None
    confidence: str
    matched_rule: str | None


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    text = html.unescape(str(value))
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.replace("&", " and ")
    text = re.sub(r"[_/]+", " ", text)
    text = re.sub(r"[^a-zA-Z0-9\s-]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text


def should_exclude(path: Path) -> bool:
    return any(part in EXCLUDED_PATH_PARTS for part in path.parts)


def resolve_input_files(base_dir: Path, patterns: list[str]) -> list[Path]:
    files: set[Path] = set()
    for pattern in patterns:
        for path in base_dir.glob(pattern):
            if path.is_file() and not should_exclude(path):
                files.add(path)
    return sorted(files)


def extract_source(record: dict, path: Path) -> str:
    for key in ("platform", "source", "merchant_id", "merchant_name"):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    if "data" in path.parts:
        idx = path.parts.index("data")
        if idx + 1 < len(path.parts):
            return path.parts[idx + 1]
    return "unknown"


def guess_category_from_path(path: Path) -> str | None:
    stem = normalize_text(path.stem)
    if not stem or re.fullmatch(r"products \d+", stem):
        return None
    if stem in {"products", "catalog sg deduped", "catalog mapped"}:
        return None
    return stem


def extract_category(record: dict, path: Path) -> str | None:
    candidates = [
        record.get("category"),
        record.get("primary_category"),
        record.get("taxonomy"),
        record.get("category_name"),
        record.get("category_slug"),
    ]
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return html.unescape(candidate.strip())
        if isinstance(candidate, list):
            values = [str(value).strip() for value in candidate if str(value).strip()]
            if values:
                return " > ".join(values)
    return guess_category_from_path(path)


def build_segments(raw_category: str) -> list[str]:
    normalized = normalize_text(raw_category)
    segments = [normalized]
    for token in (" - ", " > ", ":", ","):
        next_segments: list[str] = []
        for segment in segments:
            next_segments.extend(part.strip() for part in segment.split(token) if part.strip())
        segments.extend(next_segments)
    unique_segments: list[str] = []
    seen = set()
    for segment in segments:
        if segment and segment not in seen:
            seen.add(segment)
            unique_segments.append(segment)
    return unique_segments


def classify_category(raw_category: str) -> CategoryMatch:
    segments = build_segments(raw_category)

    for segment in segments:
        if segment in EXACT_CATEGORY_RULES:
            return CategoryMatch(EXACT_CATEGORY_RULES[segment], "exact", segment)

    scores = {taxonomy: 0 for taxonomy in STANDARD_TAXONOMY}
    matched_keywords: dict[str, str] = {}
    for segment in segments:
        for taxonomy, keywords in KEYWORD_RULES.items():
            for keyword in keywords:
                if keyword in segment:
                    scores[taxonomy] += 1
                    matched_keywords.setdefault(taxonomy, keyword)

    best_taxonomy = None
    best_score = 0
    for taxonomy in STANDARD_TAXONOMY:
        score = scores[taxonomy]
        if score > best_score:
            best_taxonomy = taxonomy
            best_score = score

    if best_taxonomy and best_score > 0:
        confidence = "high" if best_score >= 2 else "medium"
        return CategoryMatch(best_taxonomy, confidence, matched_keywords.get(best_taxonomy))

    return CategoryMatch(None, "unmapped", None)


def analyze_files(files: Iterable[Path]) -> tuple[dict[str, Counter], Counter, int]:
    source_category_counts: dict[str, Counter] = defaultdict(Counter)
    category_totals: Counter = Counter()
    total_products = 0

    for path in files:
        with path.open() as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                source = extract_source(record, path)
                category = extract_category(record, path)
                if not category:
                    continue
                source_category_counts[source][category] += 1
                category_totals[category] += 1
                total_products += 1

    return source_category_counts, category_totals, total_products


def build_output(files: list[Path]) -> dict:
    source_category_counts, category_totals, total_products = analyze_files(files)

    mapping = {}
    unmapped_categories = []
    for category, product_count in sorted(category_totals.items()):
        match = classify_category(category)
        sources = sorted(
            source for source, counts in source_category_counts.items() if counts.get(category)
        )
        mapping[category] = {
            "mapped_category": match.mapped_category,
            "confidence": match.confidence,
            "matched_rule": match.matched_rule,
            "product_count": product_count,
            "sources": sources,
        }
        if match.mapped_category is None:
            unmapped_categories.append(
                {
                    "source_category": category,
                    "product_count": product_count,
                    "sources": sources,
                }
            )

    source_stats = {}
    for source, counts in sorted(source_category_counts.items()):
        mapped_counter = Counter()
        unmapped_count = 0
        for category, count in counts.items():
            mapped_category = mapping[category]["mapped_category"]
            if mapped_category:
                mapped_counter[mapped_category] += count
            else:
                unmapped_count += count

        source_stats[source] = {
            "unique_categories": len(counts),
            "products_with_category": sum(counts.values()),
            "mapped_products": sum(mapped_counter.values()),
            "unmapped_products": unmapped_count,
            "mapped_distribution": dict(sorted(mapped_counter.items())),
        }

    return {
        "version": "2.0",
        "standard_taxonomy": STANDARD_TAXONOMY,
        "input_files": [str(path.relative_to(Path.cwd())) for path in files],
        "summary": {
            "total_files": len(files),
            "total_products_with_category": total_products,
            "total_sources": len(source_category_counts),
            "total_unique_categories": len(category_totals),
            "mapped_categories": len(category_totals) - len(unmapped_categories),
            "unmapped_categories": len(unmapped_categories),
        },
        "source_stats": source_stats,
        "mapping": mapping,
        "unmapped_categories": sorted(
            unmapped_categories,
            key=lambda item: (-item["product_count"], item["source_category"].lower()),
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Map source categories to BuyWhere standard taxonomy.")
    parser.add_argument(
        "--input-pattern",
        action="append",
        dest="input_patterns",
        help="Glob pattern relative to repo root. Can be provided multiple times.",
    )
    parser.add_argument(
        "--output",
        default="scripts/category_mapping.json",
        help="Output JSON path relative to repo root.",
    )
    args = parser.parse_args()

    base_dir = Path(__file__).resolve().parents[1]
    patterns = args.input_patterns or DEFAULT_INPUT_PATTERNS
    files = resolve_input_files(base_dir, patterns)
    if not files:
        raise SystemExit("No input files found for category mapping.")

    output = build_output(files)
    output_path = base_dir / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2) + "\n")

    summary = output["summary"]
    print(f"Scanned {summary['total_files']} files")
    print(f"Products with category: {summary['total_products_with_category']:,}")
    print(f"Unique categories: {summary['total_unique_categories']}")
    print(f"Mapped categories: {summary['mapped_categories']}")
    print(f"Unmapped categories: {summary['unmapped_categories']}")
    print(f"Output: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
