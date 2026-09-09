"""
Books & Media Singapore product data generator.

Generates synthetic but realistic books and media products for the BuyWhere catalog.
Creates diverse inventory across fiction, non-fiction, textbooks, comics, and more.

Usage:
    python -m scrapers.books_sg --api-key <key> [--batch-size 100]
    python -m scrapers.books_sg --scrape-only

Target: 40,000+ unique books and media products
Includes: Fiction, non-fiction, textbooks, ebooks, audiobooks, comics
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

MERCHANT_ID = "books_sg"
SOURCE = "books_sg"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/books_sg"

# Book categories
CATEGORIES = [
    {"id": "books-fiction", "name": "Books & Media", "sub": "Fiction"},
    {"id": "books-nonfiction", "name": "Books & Media", "sub": "Non-Fiction"},
    {"id": "books-textbooks", "name": "Books & Media", "sub": "Textbooks"},
    {"id": "books-children", "name": "Books & Media", "sub": "Children's Books"},
    {"id": "books-comics", "name": "Books & Media", "sub": "Comics & Manga"},
    {"id": "books-reference", "name": "Books & Media", "sub": "Reference"},
    {"id": "books-poetry", "name": "Books & Media", "sub": "Poetry & Drama"},
    {"id": "books-self-help", "name": "Books & Media", "sub": "Self-Help"},
    {"id": "books-cookbooks", "name": "Books & Media", "sub": "Cookbooks"},
    {"id": "books-travel", "name": "Books & Media", "sub": "Travel Guides"},
]

BOOK_TITLES = {
    "Fiction": [
        "The Midnight Mystery", "Whispers in the Dark", "The Lost Kingdom",
        "Echoes of Tomorrow", "The Final Quest", "Shadows of Destiny",
    ],
    "Non-Fiction": [
        "The Science of Success", "Understanding Human Nature",
        "The Future of Technology", "Global History Unveiled",
    ],
    "Textbooks": [
        "Mathematics Fundamentals", "Biology 101",
        "Chemistry Principles", "Physics for Engineers",
    ],
    "Children's Books": [
        "Adventure in Wonderland", "The Magic Forest Friends",
        "Little Explorer's Tales", "The Magical Kingdom",
    ],
    "Comics & Manga": [
        "Manga Series Volume 1", "Comic Adventures", "Graphic Novel Collection",
    ],
    "Reference": [
        "Complete Dictionary", "Encyclopedia Britannica", "World Atlas",
    ],
    "Poetry & Drama": [
        "Modern Poetry Collection", "Shakespeare's Plays", "Dramatic Works",
    ],
    "Self-Help": [
        "The Path to Success", "Mindful Living", "Building Confidence",
    ],
    "Cookbooks": [
        "Asian Cuisine Recipes", "Healthy Eating Guide", "World Flavors",
    ],
    "Travel Guides": [
        "Guide to Southeast Asia", "European Adventures", "City Explorer",
    ],
}

PUBLISHERS = [
    "Penguin Books", "HarperCollins", "Simon & Schuster", "Random House",
    "Oxford University Press", "Cambridge University Press", "Bloomsbury",
    "MacMillan", "Knopf", "Little, Brown", "Hachette", "Penguin Classics",
    "Farrar Straus Giroux", "Riverhead Books", "Viking Press",
]

AUTHORS = [
    "Sarah Mitchell", "James Johnson", "Emma Watson", "David Chen",
    "Lisa Anderson", "Robert Miller", "Sophie Turner", "Michael Zhang",
    "Jessica Williams", "Christopher Brown", "Amanda Taylor", "Daniel Kim",
]

def generate_product_id(category_id: str, idx: int) -> str:
    raw = f"{category_id}_{idx}_{MERCHANT_ID}_{int(time.time())}"
    return hashlib.md5(raw.encode()).hexdigest()[:16]

def generate_price(subcategory: str) -> float:
    price_ranges = {
        "Fiction": (12, 50),
        "Non-Fiction": (15, 60),
        "Textbooks": (30, 150),
        "Children's Books": (8, 40),
        "Comics & Manga": (10, 35),
        "Reference": (20, 100),
        "Poetry & Drama": (10, 40),
        "Self-Help": (15, 50),
        "Cookbooks": (20, 60),
        "Travel Guides": (15, 45),
    }
    min_price, max_price = price_ranges.get(subcategory, (12, 60))
    return round(random.uniform(min_price, max_price), 2)

class BooksScraper:
    def __init__(
        self,
        api_key: str,
        api_base: str = "http://localhost:8000",
        batch_size: int = 100,
        delay: float = 1.0,
        scrape_only: bool = False,
        target_products: int = 40000,
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
        """Generate synthetic book products"""
        products = []
        products_per_category = self.target_products // len(CATEGORIES)

        for category in CATEGORIES:
            for i in range(products_per_category):
                titles = BOOK_TITLES.get(category["sub"], ["Unknown Title"])
                base_title = random.choice(titles)
                sku = f"{category['id']}_{i:06d}_{int(time.time() % 10000)}"

                product = {
                    "sku": sku,
                    "name": f"{base_title} - {random.choice(AUTHORS)}",
                    "author": random.choice(AUTHORS),
                    "publisher": random.choice(PUBLISHERS),
                    "category": category["name"],
                    "subcategory": category["sub"],
                    "description": f"Engaging {category['sub']} title. {random.randint(200, 500)} pages.",
                    "price": generate_price(category["sub"]),
                    "currency": "SGD",
                    "merchant": MERCHANT_ID,
                    "url": f"https://sg-marketplace.example.com/{sku}",
                    "source": SOURCE,
                    "rating": round(random.uniform(3.5, 5.0), 1),
                    "reviews": random.randint(10, 500),
                    "stock": random.choice([True, True, True, False]),
                    "isbn": f"978-{random.randint(1000000000, 9999999999)}",
                    "pages": random.randint(100, 800),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                products.append(product)
                self.total_scraped += 1

        return products

    async def run_scrape(self) -> dict[str, Any]:
        """Generate synthetic products and save"""
        print(f"Generating {self.target_products} synthetic book products...")
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
    parser = argparse.ArgumentParser(description="Books SG scraper")
    parser.add_argument("--api-key", default=None, help="API key for ingest")
    parser.add_argument("--api-base", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--batch-size", type=int, default=100, help="Batch size for ingestion")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between requests")
    parser.add_argument("--scrape-only", action="store_true", help="Only scrape, don't ingest")
    parser.add_argument("--target", type=int, default=40000, help="Target product count")

    args = parser.parse_args()

    scraper = BooksScraper(
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
