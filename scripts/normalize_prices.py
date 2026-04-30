#!/usr/bin/env python3
import json
import os
import glob
from pathlib import Path

EXCHANGE_RATES_TO_USD = {
    "SGD": 0.74,
    "AUD": 0.65,
    "NZD": 0.60,
    "IDR": 0.000063,
    "VND": 0.000040,
    "INR": 0.012,
    "MYR": 0.22,
    "PHP": 0.018,
    "THB": 0.029,
    "JPY": 0.0067,
    "KRW": 0.00075,
}

def normalize_price(record):
    currency = record.get("currency", "USD").upper()
    price = record.get("price", 0)
    
    if currency == "USD":
        record["price_usd"] = price
    elif currency in EXCHANGE_RATES_TO_USD:
        record["price_usd"] = round(price * EXCHANGE_RATES_TO_USD[currency], 2)
    else:
        record["price_usd"] = None
    
    return record

def process_file(input_path, output_path=None):
    if output_path is None:
        output_path = input_path.replace(".ndjson", "_normalized.ndjson")
    
    processed = 0
    failed = 0
    
    with open(input_path, "r") as infile, open(output_path, "w") as outfile:
        for line in infile:
            try:
                record = json.loads(line.strip())
                record = normalize_price(record)
                outfile.write(json.dumps(record) + "\n")
                processed += 1
            except Exception as e:
                failed += 1
    
    return processed, failed

def main():
    data_dir = Path("/home/paperclip/buywhere/data")
    ndjson_files = list(data_dir.glob("*.ndjson"))
    
    if not ndjson_files:
        print("No NDJSON files found")
        return
    
    print(f"Found {len(ndjson_files)} NDJSON files")
    
    total_processed = 0
    total_failed = 0
    
    for ndjson_file in ndjson_files:
        if "normalized" in ndjson_file.name:
            continue
        
        print(f"Processing {ndjson_file.name}...")
        processed, failed = process_file(str(ndjson_file))
        total_processed += processed
        total_failed += failed
        print(f"  Processed: {processed}, Failed: {failed}")
    
    print(f"\nTotal: {total_processed} processed, {total_failed} failed")

if __name__ == "__main__":
    main()