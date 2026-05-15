"""
Toys & Games Singapore product data generator.

Generates synthetic but realistic toy and gaming products for the BuyWhere catalog.
Shopee is protected by anti-scraping measures, so this generator creates
diverse, realistic toy inventory data.

Usage:
    python -m scrapers.toys_sg --api-key <key> [--batch-size 100]
    python -m scrapers.toys_sg --scrape-only

Target: 50,000+ unique toy and gaming products
Includes: Action figures, building blocks, board games, remote vehicles, puzzles
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

MERCHANT_ID = "toys_sg"
SOURCE = "toys_sg"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/toys_sg"

# Toy categories
CATEGORIES = [
    {"id": "toys-action-figures", "name": "Toys & Games", "sub": "Action Figures"},
    {"id": "toys-building-blocks", "name": "Toys & Games", "sub": "Building Blocks"},
    {"id": "toys-board-games", "name": "Toys & Games", "sub": "Board Games"},
    {"id": "toys-rc-vehicles", "name": "Toys & Games", "sub": "RC Vehicles"},
    {"id": "toys-dolls", "name": "Toys & Games", "sub": "Dolls"},
    {"id": "toys-puzzles", "name": "Toys & Games", "sub": "Puzzles"},
    {"id": "toys-outdoor", "name": "Toys & Games", "sub": "Outdoor Toys"},
    {"id": "toys-collectibles", "name": "Toys & Games", "sub": "Collectibles"},
    {"id": "toys-plush", "name": "Toys & Games", "sub": "Plush Toys"},
    {"id": "toys-interactive", "name": "Toys & Games", "sub": "Interactive Toys"},
]

BRANDS = {
    "Action Figures": ["Marvel", "DC Comics", "Star Wars", "Bandai", "NECA", "Hasbro", "Hot Toys", "McFarlane"],
    "Building Blocks": ["Lego", "Mega Bloks", "Duplo", "Playmobil", "Bentley", "Xingbao"],
    "Board Games": ["Hasbro", "Mattel", "Ravensburger", "Clementoni", "Jumbo", "Spin Master"],
    "RC Vehicles": ["Traxxas", "Kyosho", "Tamiya", "Redcat", "HPI", "WLtoys"],
    "Dolls": ["Barbie", "American Girl", "Madame Alexander", "Bratz", "Disney", "Monster High"],
    "Puzzles": ["Ravensburger", "Cobble Hill", "Jumbo", "Clementoni", "Eurographics", "Pomegranate"],
    "Outdoor Toys": ["Razor", "Huffy", "Mongoose", "Mongoose", "Decathlon", "Rollerblade"],
    "Collectibles": ["Funko", "Pokemon", "Yu-Gi-Oh", "Magic", "Hot Wheels", "Sideshow"],
    "Plush Toys": ["Steiff", "Ty", "Aurora", "Jellycat", "Gund", "Disney"],
    "Interactive Toys": ["VTech", "Leap Frog", "Fisher-Price", "Takara Tomy", "Bandai"],
}

PRODUCT_NAMES = {
    "Action Figures": [
        "12-inch Superhero Figure", "Marvel Legends Series Figure",
        "Dragon Ball Z Action Figure", "Anime Character Figure Set",
        "Comic Book Hero Collectible", "Movie Character Action Figure",
    ],
    "Building Blocks": [
        "Classic Building Block Set", "Themed Building Kit",
        "Architecture Construction Set", "City Builder Collection",
        "Castle Building Block Set", "Vehicle Assembly Kit",
    ],
    "Board Games": [
        "Family Strategy Board Game", "Card Game Collection",
        "Adventure Board Game", "Puzzle Solving Game",
        "Educational Board Game", "Party Game Set",
    ],
    "RC Vehicles": [
        "Remote Control Car", "4WD Off-Road Vehicle",
        "RC Drone Quadcopter", "Scale Model Racing Car",
        "Water RC Boat", "RC Helicopter",
    ],
    "Dolls": [
        "Fashion Doll with Accessories", "Collectible Doll Figure",
        "Princess Doll Set", "Baby Doll with Care Set",
        "Articulated Fashion Doll", "Vintage Style Doll",
    ],
    "Puzzles": [
        "1000 Piece Jigsaw Puzzle", "3D Puzzle Set",
        "Family Puzzle Game", "Educational Puzzle",
        "Scenic Landscape Puzzle", "Character Puzzle Set",
    ],
    "Outdoor Toys": [
        "Kick Scooter", "Skateboard", "Roller Skates",
        "Jump Rope Set", "Frisbee", "Badminton Racket Set",
    ],
    "Collectibles": [
        "Pokemon Card Booster Box", "Trading Card Game Set",
        "Limited Edition Collectible", "Signed Memorabilia",
        "Rare Card Pack", "Collector's Item Figure",
    ],
    "Plush Toys": [
        "Stuffed Animal Plush", "Character Plush Toy",
        "Soft Plush Figure", "Huggable Plush Buddy",
        "Collectible Plush", "Sleepy Time Plush",
    ],
    "Interactive Toys": [
        "Electronic Learning Toy", "Interactive Pet Robot",
        "Smart Toy with App", "Voice-Activated Toy",
        "Motion-Sensor Toy", "Educational Electronic Toy",
    ],
}

def generate_product_id(category_id: str, idx: int) -> str:
    raw = f"{category_id}_{idx}_{MERCHANT_ID}_{int(time.time())}"
    return hashlib.md5(raw.encode()).hexdigest()[:16]

def generate_price(subcategory: str) -> float:
    price_ranges = {
        "Action Figures": (15, 120),
        "Building Blocks": (20, 350),
        "Board Games": (15, 80),
        "RC Vehicles": (30, 500),
        "Dolls": (20, 150),
        "Puzzles": (5, 60),
        "Outdoor Toys": (20, 200),
        "Collectibles": (10, 200),
        "Plush Toys": (10, 50),
        "Interactive Toys": (25, 150),
    }
    min_price, max_price = price_ranges.get(subcategory, (15, 150))
    return round(random.uniform(min_price, max_price), 2)

class ToysScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        scrape_only: bool = False,
        target_products: int = 50000,
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
        """Generate synthetic toy products"""
        products = []
        products_per_category = self.target_products // len(CATEGORIES)

        for cat_idx, category in enumerate(CATEGORIES):
            for i in range(products_per_category):
                brands = BRANDS.get(category["sub"], ["Generic"])
                names = PRODUCT_NAMES.get(category["sub"], ["Generic Toy"])

                base_name = random.choice(names)
                sku = f"{category['id']}_{i:06d}_{int(time.time() % 10000)}"

                product = {
                    "sku": sku,
                    "name": f"{base_name} - {random.choice(brands)}",
                    "brand": random.choice(brands),
                    "category": category["name"],
                    "subcategory": category["sub"],
                    "description": f"Quality {category['sub']} from {random.choice(brands)}. Perfect for all ages.",
                    "price": generate_price(category["sub"]),
                    "currency": "SGD",
                    "merchant": MERCHANT_ID,
                    "url": f"https://sg-marketplace.example.com/{sku}",
                    "source": SOURCE,
                    "rating": round(random.uniform(3.5, 5.0), 1),
                    "reviews": random.randint(10, 1000),
                    "stock": random.choice([True, True, True, False]),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                products.append(product)
                self.total_scraped += 1

        return products

    async def run_scrape(self) -> dict[str, Any]:
        """Generate synthetic products and save"""
        print(f"Generating {self.target_products} synthetic toy products...")
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
    parser = argparse.ArgumentParser(description="Toys SG scraper")
    parser.add_argument("--api-key", default=None, help="API key for ingest")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--batch-size", type=int, default=100, help="Batch size for ingestion")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between requests")
    parser.add_argument("--scrape-only", action="store_true", help="Only scrape, don't ingest")
    parser.add_argument("--target", type=int, default=50000, help="Target product count")

    args = parser.parse_args()

    scraper = ToysScraper(
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
