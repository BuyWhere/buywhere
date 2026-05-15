#!/usr/bin/env python3
"""Feed validated Shopify merchants to the ingestion pipeline.

Takes validated merchants from discovery and queues them for product extraction.
"""
import json
import sys
from pathlib import Path
from datetime import datetime

VALIDATED_FILE = Path(__file__).resolve().parent.parent / "data" / "discovery" / "validated" / "validated_us_merchants.jsonl"
QUEUE_FILE = Path(__file__).resolve().parent.parent / "data" / "discovery" / "ingestion_queue.jsonl"


def load_validated_merchants():
    """Load all validated merchants from the discovery output."""
    merchants = []
    if not VALIDATED_FILE.exists():
        print(f"Error: {VALIDATED_FILE} not found")
        return []

    with open(VALIDATED_FILE) as f:
        for line in f:
            try:
                rec = json.loads(line)
                if rec.get("status") == "valid_shopify" and rec.get("has_products"):
                    merchants.append({
                        "domain": rec["domain"],
                        "source": rec.get("source", "unknown"),
                        "country": rec.get("country", "US"),
                        "state": rec.get("state", ""),
                        "merchant_name": rec.get("merchant_name", ""),
                        "categories": rec.get("categories", ""),
                        "product_count_sample": rec.get("product_count_sample", 0),
                        "discovered_at": datetime.utcnow().isoformat(),
                    })
            except json.JSONDecodeError:
                pass

    return merchants


def queue_merchants(merchants):
    """Queue merchants for product extraction."""
    queued = 0
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)

    with open(QUEUE_FILE, "a") as f:
        for m in merchants:
            f.write(json.dumps(m) + "\n")
            queued += 1

    return queued


def main():
    merchants = load_validated_merchants()
    print(f"Loaded {len(merchants)} validated merchants with products")

    if merchants:
        queued = queue_merchants(merchants)
        print(f"Queued {queued} merchants for ingestion")
        print(f"Queue file: {QUEUE_FILE}")
    else:
        print("No validated merchants to queue")


if __name__ == "__main__":
    main()
