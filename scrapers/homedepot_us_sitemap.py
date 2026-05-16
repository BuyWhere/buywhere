"""
Home Depot US sitemap scraper - proxy-free.

Target: 100K+ home improvement products via sitemap.xml.
Tag: region=us, country_code=US, currency=USD

This is a proxy-free scraper that uses Home Depot's sitemap.xml
to discover product URLs and then scrapes individual product pages directly.

Usage:
    python3 homedepot_us_sitemap.py --scrape-only --limit 100000
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import time
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin, urlparse

import aiohttp
import os
import urllib.parse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("homedepot_us_sitemap")

DATA_DIR = Path("/home/paperclip/buywhere-api/data")
MERCHANT_ID = "homedepot_us"
SOURCE = "homedepot_us"
BASE_URL = "https://www.homedepot.com"
PRODUCT_BASE = BASE_URL
SITEMAP_URL = "https://www.homedepot.com/sitemap.xml"
SITEMAP_INDEX_URL = "https://www.homedepot.com/sitemap_index.xml"

# Default headers for HTTP requests
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "max-age=0",
}

@dataclass
class ProductData:
    url: str
    title: str = ""
    price: str = ""
    brand: str = ""
    description: str = ""
    category: str = ""
    in_stock: bool = True
    image_url: str = ""
    specs: dict[str, str] = None
    
    def __post_init__(self):
        if self.specs is None:
            self.specs = {}

@dataclass
class ScrapeStats:
    total_urls: int = 0
    scraped: int = 0
    skipped: int = 0
    errors: int = 0
    start_time: float = 0
    end_time: Optional[float] = None

class HomeDepotSitemapScraper:
    def __init__(self, limit: int = 100000):
        self.limit = limit
        self.data_dir = DATA_DIR / MERCHANT_ID
        self.output_file = self.data_dir / "products.jsonl"
        self.stats = ScrapeStats()
        self.session: Optional[aiohttp.ClientSession] = None
        self.scraped_urls = set()
        
        # Create data directory if it doesn't exist
        self.data_dir.mkdir(parents=True, exist_ok=True)
        
        # Load existing URLs if file exists
        if self.output_file.exists():
            self._load_existing_urls()
    
    def _load_existing_urls(self):
        """Load existing URLs from the output file to avoid duplicates."""
        if self.output_file.exists():
            logger.info(f"Loading existing URLs from {self.output_file}")
            with open(self.output_file, 'r', encoding='utf-8') as f:
                for line in f:
                    try:
                        data = json.loads(line.strip())
                        if 'url' in data:
                            self.scraped_urls.add(data['url'])
                    except json.JSONDecodeError:
                        continue
            logger.info(f"Found {len(self.scraped_urls)} existing products")
    
    async def fetch_with_retry(self, url: str, max_retries: int = 3) -> Optional[str]:
        """Fetch URL with retry logic - no proxy, direct requests."""
        for attempt in range(max_retries):
            try:
                logger.info(f"Fetching {url} (attempt {attempt + 1}/{max_retries})")

                connector = aiohttp.TCPConnector(limit=100, ttl_dns_cache=300, ssl=True)
                async with aiohttp.ClientSession(
                    connector=connector,
                    timeout=aiohttp.ClientTimeout(total=30, connect=10),
                    headers=HEADERS
                ) as session:
                    async with session.get(url, timeout=30) as response:
                        if response.status == 200:
                            return await response.text()
                        else:
                            logger.warning(f"Failed to fetch {url}: {response.status}")
                            return None

            except Exception as e:
                logger.error(f"Error fetching {url} (attempt {attempt + 1}): {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(5)

        return None

    async def fetch_product_urls_from_sitemap(self) -> list[str]:
        """Fetch product URLs directly from Home Depot's sitemap."""
        all_urls = []

        # First try the main sitemap
        logger.info(f"Fetching sitemap from {SITEMAP_URL}")
        sitemap_content = await self.fetch_with_retry(SITEMAP_URL)

        if sitemap_content:
            try:
                root = ET.fromstring(sitemap_content)
                ns = {'ns': 'http://www.sitemaps.org/schemas/sitemap/0.9'}

                # Check if this is a sitemap index
                loc_elements = root.findall('.//ns:loc', ns)
                if not loc_elements:
                    loc_elements = root.findall('.//loc')

                # If we found loc elements, check if they're product URLs or sitemap references
                for loc in loc_elements:
                    url = loc.text
                    if url:
                        if '/p/' in url:  # Product URL
                            all_urls.append(url)
                        elif 'sitemap' in url:  # Sub-sitemap
                            logger.info(f"Found sub-sitemap: {url}")
                            subsitemap_content = await self.fetch_with_retry(url)
                            if subsitemap_content:
                                sub_root = ET.fromstring(subsitemap_content)
                                sub_locs = sub_root.findall('.//ns:loc', ns)
                                if not sub_locs:
                                    sub_locs = sub_root.findall('.//loc')
                                for sub_loc in sub_locs:
                                    sub_url = sub_loc.text
                                    if sub_url and '/p/' in sub_url:
                                        all_urls.append(sub_url)
                            await asyncio.sleep(1)  # Delay between sitemap requests

                logger.info(f"Found {len(all_urls)} product URLs from sitemap")
            except ET.ParseError as e:
                logger.error(f"Failed to parse sitemap: {e}")
                return all_urls

        return all_urls[:self.limit]
    
    def extract_product_data(self, html: str, url: str) -> ProductData:
        """Extract product data from HTML."""
        product = ProductData(url=url)
        
        # Extract title
        title_match = re.search(r'<h1[^>]*class="[^"]*product-title[^"]*"[^>]*>(.*?)</h1>', html, re.IGNORECASE | re.DOTALL)
        if title_match:
            product.title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip()
        
        # Extract price
        price_patterns = [
            r'<span[^>]*class="[^"]*price[^"]*"[^>]*>(.*?)</span>',
            r'<span[^>]*class="[^"]*current-price[^"]*"[^>]*>(.*?)</span>',
            r'<span[^>]*class="[^"]*money[^"]*"[^>]*>(.*?)</span>',
        ]
        
        for pattern in price_patterns:
            price_match = re.search(pattern, html, re.IGNORECASE)
            if price_match:
                product.price = price_match.group(1).strip()
                break
        
        # Extract brand
        brand_match = re.search(r'<span[^>]*class="[^"]*brand[^"]*"[^>]*>(.*?)</span>', html, re.IGNORECASE)
        if brand_match:
            product.brand = brand_match.group(1).strip()
        
        # Extract description
        desc_patterns = [
            r'<div[^>]*class="[^"]*description[^"]*"[^>]*>(.*?)</div>',
            r'<div[^>]*class="[^"]*product-description[^"]*"[^>]*>(.*?)</div>',
            r'<meta[^>]*name="description"[^>]*content="(.*?)"[^>]*>',
        ]
        
        for pattern in desc_patterns:
            desc_match = re.search(pattern, html, re.IGNORECASE)
            if desc_match:
                product.description = desc_match.group(1).strip()
                break
        
        # Extract image URL
        img_match = re.search(r'<img[^>]*class="[^"]*product-image[^"]*"[^>]*src="(.*?)"[^>]*>', html, re.IGNORECASE)
        if img_match:
            product.image_url = urljoin(BASE_URL, img_match.group(1))
        
        return product
    
    async def scrape_product(self, url: str) -> Optional[ProductData]:
        """Scrape a single product page."""
        try:
            async with self.session.get(url, headers=HEADERS, timeout=30) as response:
                if response.status == 200:
                    html = await response.text()
                    product = self.extract_product_data(html, url)
                    return product
                else:
                    logger.warning(f"Failed to scrape {url}: {response.status}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error scraping {url}: {e}")
            return None
    
    async def scrape_all_products(self, urls: list[str]) -> list[ProductData]:
        """Scrape all product URLs."""
        products = []
        
        for i, url in enumerate(urls):
            if url in self.scraped_urls:
                self.stats.skipped += 1
                continue
            
            logger.info(f"Scraping product {i+1}/{len(urls)}: {url}")
            
            product = await self.scrape_product(url)
            if product:
                products.append(product)
                self.stats.scraped += 1
                self.scraped_urls.add(url)
                
                # Save product immediately
                await self._save_product(product)
            else:
                self.stats.errors += 1
            
            # Small delay to avoid rate limiting
            await asyncio.sleep(0.5)
            
            # Update progress
            if (i + 1) % 100 == 0:
                logger.info(f"Progress: {i+1}/{len(urls)} products scraped")
        
        return products
    
    async def _save_product(self, product: ProductData):
        """Save a single product to the JSONL file."""
        with open(self.output_file, 'a', encoding='utf-8') as f:
            json.dump({
                'url': product.url,
                'title': product.title,
                'price': product.price,
                'brand': product.brand,
                'description': product.description,
                'category': product.category,
                'in_stock': product.in_stock,
                'image_url': product.image_url,
                'specs': product.specs,
                'merchant_id': MERCHANT_ID,
                'source': SOURCE,
                'scraped_at': datetime.now(timezone.utc).isoformat()
            }, f, ensure_ascii=False)
            f.write('\n')
    
    async def run(self) -> dict[str, Any]:
        """Run the scraper."""
        self.stats.start_time = time.time()
        logger.info(f"Starting Home Depot sitemap scraper with limit {self.limit}")
        logger.info("Using direct/proxy-free requests (no proxy service)")

        # Create HTTP session
        connector = aiohttp.TCPConnector(limit=100, ttl_dns_cache=300, ssl=True)
        timeout = aiohttp.ClientTimeout(total=30, connect=10)

        async with aiohttp.ClientSession(
            connector=connector,
            timeout=timeout,
            headers=HEADERS
        ) as session:
            self.session = session

            # Step 1: Fetch product URLs from sitemap
            logger.info("Step 1: Fetching product URLs from sitemap...")
            product_urls = await self.fetch_product_urls_from_sitemap()
            self.stats.total_urls = len(product_urls)
            logger.info(f"Found {len(product_urls)} product URLs to scrape")

            if not product_urls:
                logger.error("No product URLs found")
                return self._get_result()

            # Step 2: Scrape products
            logger.info("Step 2: Scraping products...")
            products = await self.scrape_all_products(product_urls)

        self.stats.end_time = time.time()

        # Generate final stats
        result = self._get_result()
        logger.info(f"Scraping complete: {result}")

        return result
    
    def _get_result(self) -> dict[str, Any]:
        """Get scraping result stats."""
        duration = 0
        if self.stats.start_time and self.stats.end_time:
            duration = self.stats.end_time - self.stats.start_time
        
        return {
            'merchant_id': MERCHANT_ID,
            'source': SOURCE,
            'total_urls_found': self.stats.total_urls,
            'products_scraped': self.stats.scraped,
            'products_skipped': self.stats.skipped,
            'errors': self.stats.errors,
            'duration_seconds': duration,
            'output_file': str(self.output_file),
            'products_per_second': self.stats.scraped / duration if duration > 0 else 0
        }

def main():
    parser = argparse.ArgumentParser(description="Home Depot US sitemap scraper")
    parser.add_argument("--scrape-only", action="store_true", help="Only scrape, don't post-process")
    parser.add_argument("--limit", type=int, default=100000, help="Maximum number of products to scrape")
    parser.add_argument("--output", help="Output file path")
    
    args = parser.parse_args()
    
    scraper = HomeDepotSitemapScraper(limit=args.limit)
    result = asyncio.run(scraper.run())
    
    print(f"Scraping completed: {result}")

if __name__ == "__main__":
    main()