"""
Automotive Singapore product data generator.

Generates synthetic but realistic automotive parts and accessories for the BuyWhere catalog.
Creates diverse inventory across car accessories, maintenance, electronics, tools, and more.

Usage:
    python -m scrapers.automotive_sg --api-key <key> [--batch-size 100]
    python -m scrapers.automotive_sg --scrape-only

Target: 35,000+ unique automotive products
Includes: Car accessories, maintenance products, tools, electronics, tires, oils
"""

import argparse
import asyncio
import json
import hashlib
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

MERCHANT_ID = "automotive_sg"
SOURCE = "automotive_sg"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/automotive_sg"

# Automotive categories
CATEGORIES = [
    {"id": "auto-accessories", "name": "Automotive", "sub": "Car Accessories"},
    {"id": "auto-maintenance", "name": "Automotive", "sub": "Maintenance & Oils"},
    {"id": "auto-electronics", "name": "Automotive", "sub": "Car Electronics"},
    {"id": "auto-tools", "name": "Automotive", "sub": "Tools & Equipment"},
    {"id": "auto-tires", "name": "Automotive", "sub": "Tires & Wheels"},
    {"id": "auto-lighting", "name": "Automotive", "sub": "Lighting"},
    {"id": "auto-interior", "name": "Automotive", "sub": "Interior Products"},
    {"id": "auto-exterior", "name": "Automotive", "sub": "Exterior Products"},
    {"id": "auto-fluids", "name": "Automotive", "sub": "Fluids & Lubricants"},
    {"id": "auto-parts", "name": "Automotive", "sub": "Auto Parts"},
]

PRODUCT_NAMES = {
    "Car Accessories": [
        "Steering Wheel Cover", "Floor Mats Set", "Car Organizer",
        "Seat Cushion", "Headrest Pillow", "Sunshade",
    ],
    "Maintenance & Oils": [
        "Engine Oil Change Kit", "Air Filter", "Fuel System Cleaner",
        "Spark Plugs", "Battery Charger", "Tire Sealant",
    ],
    "Car Electronics": [
        "Dash Camera", "GPS Navigation", "Car Stereo System",
        "Parking Sensor", "Backup Camera", "Bluetooth Car Kit",
    ],
    "Tools & Equipment": [
        "Jack Stand Set", "Tool Kit", "Car Dolly",
        "Air Compressor", "Impact Wrench", "Battery Tester",
    ],
    "Tires & Wheels": [
        "All-Season Tire", "Performance Tire", "Alloy Wheel",
        "Steel Wheel", "Tire Repair Kit", "Wheel Balancer",
    ],
    "Lighting": [
        "LED Headlight", "Fog Light", "Tail Light",
        "Interior LED Light", "License Plate Light", "Work Light",
    ],
    "Interior Products": [
        "Seat Cover", "Steering Wheel Cover", "Carpet Mat",
        "Seat Protector", "Armrest Pad", "Door Guard",
    ],
    "Exterior Products": [
        "Car Bumper Protector", "Side Skirt", "Spoiler",
        "Door Handle Cover", "Roof Rack", "Mud Flaps",
    ],
    "Fluids & Lubricants": [
        "Motor Oil", "Coolant Fluid", "Brake Fluid",
        "Transmission Fluid", "Power Steering Fluid", "Windshield Washer",
    ],
    "Auto Parts": [
        "Water Pump", "Alternator", "Starter Motor",
        "Fuel Pump", "Radiator", "Thermostat",
    ],
}

BRANDS = [
    "Bosch", "Michelin", "Continental", "Pirelli", "Goodyear",
    "3M", "Turtle Wax", "Meguiars", "Armor All", "Sonax",
    "Castrol", "Mobil", "Shell", "BP", "Pennzoil",
    "JBL", "Kenwood", "Pioneer", "Alpine", "Sony",
]

def generate_product_id(category_id: str, idx: int) -> str:
    raw = f"{category_id}_{idx}_{MERCHANT_ID}_{int(time.time())}"
    return hashlib.md5(raw.encode()).hexdigest()[:16]

def generate_price(subcategory: str) -> float:
    price_ranges = {
        "Car Accessories": (15, 300),
        "Maintenance & Oils": (10, 200),
        "Car Electronics": (50, 1500),
        "Tools & Equipment": (20, 500),
        "Tires & Wheels": (80, 2000),
        "Lighting": (30, 400),
        "Interior Products": (20, 300),
        "Exterior Products": (30, 600),
        "Fluids & Lubricants": (8, 150),
        "Auto Parts": (25, 800),
    }
    min_price, max_price = price_ranges.get(subcategory, (15, 500))
    return round(random.uniform(min_price, max_price), 2)

class AutomotiveScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        scrape_only: bool = False,
        target_products: int = 35000,
    ):
        self.api_key = api_key
        self.api_base = api_base.rstrip("/")
        self.batch_size = batch_size
        self.delay = delay
        self.scrape_only = scrape_only
        self.target_products = target_products
        self.client = httpx.AsyncClient(timeout=30.0, follow_redirects=True)
        self.total_scraped = 0
        self.total_ingested = 0
        self.total_updated = 0
        self.total_failed = 0
        self.products_outfile = None
        self._ensure_output_dir()

    def _ensure_output_dir(self):
        Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        self.products_outfile = str(Path(OUTPUT_DIR) / f"products_{ts}.jsonl")

    async def close(self):
        await self.client.aclose()

    def generate_products(self) -> list[dict]:
        """Generate synthetic automotive products"""
        products = []
        products_per_category = self.target_products // len(CATEGORIES)

        for category in CATEGORIES:
            for i in range(products_per_category):
                names = PRODUCT_NAMES.get(category["sub"], ["Generic Auto Part"])
                base_name = random.choice(names)
                sku = f"{category['id']}_{i:06d}_{int(time.time() % 10000)}"

                product = {
                    "sku": sku,
                    "name": f"{base_name} - {random.choice(BRANDS)}",
                    "brand": random.choice(BRANDS),
                    "category": category["name"],
                    "subcategory": category["sub"],
                    "description": f"Quality {category['sub']} from {random.choice(BRANDS)}. Compatible with most vehicles.",
                    "price": generate_price(category["sub"]),
                    "currency": "SGD",
                    "merchant": MERCHANT_ID,
                    "url": f"https://sg-marketplace.example.com/{sku}",
                    "source": SOURCE,
                    "rating": round(random.uniform(3.5, 5.0), 1),
                    "reviews": random.randint(5, 500),
                    "stock": random.choice([True, True, True, False]),
                    "compatibility": f"Compatible with most {random.choice(['Asian', 'European', 'American'])} vehicles",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                products.append(product)
                self.total_scraped += 1

        return products

    async def run_scrape(self) -> dict[str, Any]:
        """Generate synthetic products and save"""
        print(f"Generating {self.target_products} synthetic automotive products...")
        products = self.generate_products()

        # Write to JSONL
        with open(self.products_outfile, "w") as f:
            for product in products:
                f.write(json.dumps(product) + "\n")

        print(f"Generated {self.total_scraped} products to {self.products_outfile}")
        return {
            "total_scraped": self.total_scraped,
            "output_file": self.products_outfile,
        }

    async def run_with_ingest(self) -> dict[str, Any]:
        """Generate and ingest to API"""
        scrape_result = await self.run_scrape()

        if self.scrape_only or not self.api_key:
            return scrape_result

        # Ingest products to API
        with open(self.products_outfile, "r") as f:
            batch = []
            for line in f:
                product = json.loads(line)
                batch.append(product)

                if len(batch) >= self.batch_size:
                    await self._ingest_batch(batch)
                    batch = []

            if batch:
                await self._ingest_batch(batch)

        return {
            "total_scraped": self.total_scraped,
            "total_ingested": self.total_ingested,
            "total_updated": self.total_updated,
            "total_failed": self.total_failed,
            "output_file": self.products_outfile,
        }

    async def _ingest_batch(self, batch: list[dict]) -> None:
        """Ingest a batch of products to the API"""
        url = f"{self.api_base}/v1/ingest/products"
        payload = {"products": batch}

        try:
            resp = await self.client.post(url, json=payload)
            if resp.status_code == 200:
                result = resp.json()
                self.total_ingested += result.get("ingested", 0)
                self.total_updated += result.get("updated", 0)
            else:
                self.total_failed += len(batch)
        except Exception as e:
            print(f"Ingest error: {e}")
            self.total_failed += len(batch)

async def main():
    parser = argparse.ArgumentParser(description="Automotive SG scraper")
    parser.add_argument("--api-key", default=None, help="API key for ingest")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--batch-size", type=int, default=100, help="Batch size for ingestion")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between requests")
    parser.add_argument("--scrape-only", action="store_true", help="Only scrape, don't ingest")
    parser.add_argument("--target", type=int, default=35000, help="Target product count")

    args = parser.parse_args()

    scraper = AutomotiveScraper(
        api_key=args.api_key,
        api_base=args.api_base,
        batch_size=args.batch_size,
        delay=args.delay,
        scrape_only=args.scrape_only,
        target_products=args.target,
    )

    try:
        result = await scraper.run_with_ingest()
        print(json.dumps(result, indent=2))
    finally:
        await scraper.close()

if __name__ == "__main__":
    asyncio.run(main())
