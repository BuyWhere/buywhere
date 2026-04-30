#!/usr/bin/env python3
"""
Analyze Zalora ID duplicate-risk patterns for BUY-3482.

The current repo has no live catalog database snapshot, so this script works from
the latest local scrape artifacts and focuses on three buckets:

1. Within-file duplicate SKUs in Zalora ID scrape output
2. Cross-run overlap between Zalora ID scrape artifacts
3. Cross-country SKU collisions that would conflict under legacy platform-level
   ingestion paths that collapse all Zalora regions into `zalora`
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DATA_ROOT = Path("/home/paperclip/buywhere-api/data")


@dataclass(frozen=True)
class Dataset:
    source: str
    path: Path


def extract_sku(row: dict[str, Any]) -> str:
    for key in ("sku", "product_id", "id"):
        value = row.get(key)
        if value:
            text = str(value)
            match = re.search(r"(\d+)$", text)
            return match.group(1) if match else text
    url = str(row.get("url", "")).rstrip("/")
    match = re.search(r"-(\d+)(?:\?.*)?$", url)
    return match.group(1) if match else ""


def extract_title(row: dict[str, Any]) -> str:
    return str(row.get("title") or row.get("name") or "").strip()


def load_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def within_file_summary(dataset: Dataset) -> dict[str, Any]:
    rows = load_rows(dataset.path)
    by_sku: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        sku = extract_sku(row)
        if sku:
            by_sku[sku].append(row)

    duplicate_groups = {
        sku: entries
        for sku, entries in by_sku.items()
        if len(entries) > 1
    }
    return {
        "source": dataset.source,
        "path": str(dataset.path),
        "rows": len(rows),
        "unique_skus": len(by_sku),
        "duplicate_rows": sum(len(entries) - 1 for entries in duplicate_groups.values()),
        "duplicate_groups": len(duplicate_groups),
        "sample_duplicate_skus": sorted(duplicate_groups)[:10],
    }


def build_latest_map(datasets: list[Dataset]) -> dict[str, dict[str, dict[str, Any]]]:
    latest: dict[str, dict[str, dict[str, Any]]] = {}
    for dataset in datasets:
        by_sku: dict[str, dict[str, Any]] = {}
        for row in load_rows(dataset.path):
            sku = extract_sku(row)
            if sku:
                by_sku[sku] = row
        latest[dataset.source] = by_sku
    return latest


def analyze() -> dict[str, Any]:
    zalora_id_runs = [
        Dataset("zalora_id_restart", DATA_ROOT / "zalora_id_new_sitemap" / "zalora_id_new_20260418_170853.jsonl"),
        Dataset("zalora_id_sitemap", DATA_ROOT / "zalora_id_new_sitemap" / "zalora_id_new_20260418_170904.jsonl"),
        Dataset("zalora_id_fast", DATA_ROOT / "zalora_id_fast" / "zalora_id_fast_20260418_171222.jsonl"),
    ]
    regional_latest = [
        Dataset("zalora_sg", DATA_ROOT / "zalora_sg_20260418.ndjson"),
        Dataset("zalora_my", DATA_ROOT / "zalora_my_sitemap" / "zalora_my_20260418.ndjson"),
        Dataset("zalora_id", DATA_ROOT / "zalora_id_new_sitemap" / "zalora_id_new_20260418_170904.jsonl"),
        Dataset("zalora_hk", DATA_ROOT / "zalora_hk_sitemap" / "zalora_hk_20260418_165944.jsonl"),
        Dataset("zalora_ph", DATA_ROOT / "zalora_ph_sitemap" / "zalora_ph_20260418_165535.jsonl"),
    ]

    within_file = [within_file_summary(dataset) for dataset in zalora_id_runs]

    run_maps = build_latest_map(zalora_id_runs)
    restart_overlap = sorted(run_maps["zalora_id_restart"].keys() & run_maps["zalora_id_sitemap"].keys())

    regional_maps = build_latest_map(regional_latest)
    collisions: list[dict[str, Any]] = []
    for other_source in ("zalora_sg", "zalora_my", "zalora_hk", "zalora_ph"):
        overlap = sorted(regional_maps["zalora_id"].keys() & regional_maps[other_source].keys())
        collisions.append(
            {
                "other_source": other_source,
                "overlap_count": len(overlap),
                "samples": [
                    {
                        "sku": sku,
                        "zalora_id_title": extract_title(regional_maps["zalora_id"][sku]),
                        "other_title": extract_title(regional_maps[other_source][sku]),
                    }
                    for sku in overlap[:10]
                ],
            }
        )

    source_aliases = [
        "zalora_id",
        "zalora_id_fast",
        "zalora_id_new",
        "zalora_id_new_sitemap",
        "zalora",
    ]

    return {
        "within_file": within_file,
        "cross_run_overlap": {
            "restart_vs_sitemap_overlap_count": len(restart_overlap),
            "overlap_skus": restart_overlap,
        },
        "cross_country_collisions": collisions,
        "source_aliases_to_normalize": source_aliases,
        "risk_summary": {
            "safe_under_unique_sku_source": "Within-source reruns update in place when source stays stable.",
            "unsafe_under_platform_sku": "Cross-country SKU reuse can overwrite unrelated products when all Zalora regions collapse to platform='zalora'.",
        },
    }


def main() -> int:
    report = analyze()
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
