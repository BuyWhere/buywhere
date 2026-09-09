"""
Simple Home Depot scraper - Focus on getting some products working
"""

import asyncio
import json
import re
import time
import argparse
from typing import Any, List, Optional
from dataclasses import dataclass
import aiohttp
from pathlib import Path

DATA_DIR = Path("/home/paperclip/buywhere-api/data")
MERCHANT_ID = "homedepot_us"
SOURCE = "homedepot_us"
BASE_URL = "https://www.homedepot.com"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]

def get_random_headers():
    import random
    return {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Cache-Control": "max-age=0",
        "Referer": "https://www.google.com/",
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

class SimpleHomeDepotScraper:
    def __init__(self, limit: int = 100000):
        self.limit = limit
        self.data_dir = DATA_DIR / MERCHANT_ID
        self.output_file = self.data_dir / "products.jsonl"
        self.scraped_urls = set()
        
        # Create data directory if it doesn't exist
        self.data_dir.mkdir(parents=True, exist_ok=True)
        
        # Load existing URLs if file exists
        if self.output_file.exists():
            self._load_existing_urls()
    
    def _load_existing_urls(self):
        """Load existing URLs from the output file to avoid duplicates."""
        if self.output_file.exists():
            print(f"Loading existing URLs from {self.output_file}")
            with open(self.output_file, 'r', encoding='utf-8') as f:
                for line in f:
                    try:
                        data = json.loads(line.strip())
                        if 'url' in data:
                            self.scraped_urls.add(data['url'])
                    except json.JSONDecodeError:
                        continue
            print(f"Found {len(self.scraped_urls)} existing products")
    
    async def fetch_with_retry(self, url: str, max_retries: int = 3) -> Optional[str]:
        """Fetch URL with retry logic."""
        headers = get_random_headers()
        
        for attempt in range(max_retries):
            try:
                print(f"Attempt {attempt + 1}/{max_retries} for {url}")
                
                # Add delay between attempts
                delay = (attempt + 1) * 3
                await asyncio.sleep(delay)
                
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, headers=headers, timeout=30) as response:
                        if response.status == 200:
                            return await response.text()
                        elif response.status in (403, 429):
                            print(f"Access denied for {url} ({response.status}), retrying...")
                            await asyncio.sleep(5)
                            continue
                        else:
                            print(f"Failed to fetch {url}: {response.status}")
                            return None
                        
            except Exception as e:
                print(f"Error fetching {url} (attempt {attempt + 1}): {e}")
                if attempt == max_retries - 1:
                    return None
                await asyncio.sleep(5)
        
        return None
    
    def get_known_product_urls(self) -> List[str]:
        """Return a list of known Home Depot product URLs for testing."""
        # Using some real product URLs that might be less protected
        known_urls = [
            "https://www.homedepot.com/p/DEWALT-20V-MAX-Compact-Brushless-3-8-in-Cordless-Right-Angle-Drill-Kit-2-Batteries-Charger-DCK290P1/204283688",
            "https://www.homedepot.com/p/Milwaukee-18-Volt-Lithium-Ion-Cordless-Compact-Drill-Kit-2-0-Batteries-Charger-Battery-48-11-2401/301298513",
            "https://www.homedepot.com/p/RYOBI-18-Volt-Cordless-1-4-in-6-Speed-Compact-Drill-Driver-2-Batteries-Charger-P1813/204406558",
            "https://www.homedepot.com/p/Bosch-12-Volt-Max-3-8-in-Cordless-Right-Angle-Impact-Wrench-Kit-Bare-Tool-GDX12E-12/305143502",
            "https://www.homedepot.com/p/Makita-18-Volt-LXT-Brushless-3-8-in-Cordless-Right-Angle-Impact-Wrench-Tool-Only-XDT08Z/205441438",
        ]
        
        # Add some more generic product URLs
        base_products = [
            "/p/Milwaukee-M18-Fuel-1-2-in-Drill-Driver-Kit-2-Batteries-Charger-4812-24/204283680",
            "/p/DEWALT-20V-MAX-1-2-in-Drill-Driver-Kit-2-Batteries-Charger-DCK271D2/204283689",
            "/p/RYOBI-18-Volt-1-2-in-Cordless-Drill-Driver-Kit-2-Batteries-Charger-P1811/204406556",
            "/p/Bosch-12-Volt-Max-3-8-in-Cordless-Drill-Driver-Kit-Bare-Tool-GSB12V-30/305143498",
            "/p/Makita-18-Volt-LXT-Brushless-1-2-in-Drill-Driver-Kit-2-Batteries-Charger-DFD621D1/205441431",
        ]
        
        # Convert to full URLs
        full_urls = [f"{BASE_URL}{url}" for url in base_products if url.startswith('/p/')]
        known_urls.extend(full_urls)
        
        return known_urls[:self.limit]
    
    async def scrape_product_page(self, url: str) -> Optional[ProductData]:
        """Scrape a single product page."""
        try:
            html = await self.fetch_with_retry(url)
            if not html:
                return None
            
            product = ProductData(url=url)
            
            # Extract title
            title_patterns = [
                r'<h1[^>]*class="[^"]*product[^"]*"[^>]*>(.*?)</h1>',
                r'<title[^>]*>(.*?)</title>',
                r'<h1[^>]*>(.*?)</h1>'
            ]
            
            for pattern in title_patterns:
                match = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
                if match:
                    product.title = re.sub(r'<[^>]+>', '', match.group(1)).strip()
                    if product.title:
                        break
            
            # Extract price
            price_patterns = [
                r'class="[^"]*price[^"]*"[^>]*>([\d,]+\.?\d*)',
                r'["\']price["\']\s*:\s*["\']?([\d,]+\.?\d*)',
                r'itemprop="price"[^>]*>([\d,]+\.?\d*)'
            ]
            
            for pattern in price_patterns:
                match = re.search(pattern, html, re.IGNORECASE)
                if match:
                    product.price = match.group(1).strip()
                    if product.price:
                        break
            
            # Extract brand
            brand_patterns = [
                r'class="[^"]*brand[^"]*"[^>]*>([^<]+)',
                r'["\']brand["\']\s*:\s*["\']?([^"\']+)',
                r'"brandName"[^>]*>([^<]+)'
            ]
            
            for pattern in brand_patterns:
                match = re.search(pattern, html)
                if match:
                    product.brand = match.group(1).strip()
                    if product.brand:
                        break
            
            # Extract description
            desc_patterns = [
                r'class="[^"]*description[^"]*"[^>]*>([^<]+)',
                r'<meta[^>]*name="description"[^>]*content="([^"]+)"',
                r'["\']description["\']\s*:\s*["\']?([^"\']+)'
            ]
            
            for pattern in desc_patterns:
                match = re.search(pattern, html)
                if match:
                    product.description = match.group(1).strip()[:2000]
                    if product.description:
                        break
            
            return product
            
        except Exception as e:
            print(f"Error scraping {url}: {e}")
            return None
    
    async def scrape_products(self, urls: List[str]) -> List[ProductData]:
        """Scrape all product URLs."""
        products = []
        
        for i, url in enumerate(urls):
            if url in self.scraped_urls:
                print(f"Skipping already scraped URL: {url}")
                continue
            
            print(f"Scraping product {i+1}/{len(urls)}: {url}")
            
            product = await self.scrape_product_page(url)
            if product:
                products.append(product)
                self.scraped_urls.add(url)
                
                # Save product immediately
                await self._save_product(product)
                
                print(f"✓ Successfully scraped: {product.title}")
            else:
                print(f"✗ Failed to scrape: {url}")
            
            # Rate limiting
            await asyncio.sleep(2.0)
            
            # Progress update
            if (i + 1) % 5 == 0:
                print(f"Progress: {i+1}/{len(urls)} products scraped")
        
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
                'scraped_at': time.time()
            }, f, ensure_ascii=False)
            f.write('\n')
    
    async def run(self) -> dict[str, Any]:
        """Run the scraper."""
        start_time = time.time()
        print(f"Starting Simple Home Depot scraper with limit {self.limit}")
        
        # Get known product URLs for testing
        print("Getting known product URLs...")
        product_urls = self.get_known_product_urls()
        
        if not product_urls:
            print("No product URLs available")
            return {
                'status': 'error',
                'message': 'No product URLs available',
                'products_scraped': 0
            }
        
        print(f"Found {len(product_urls)} product URLs to scrape")
        
        # Scrape products
        print("Scraping products...")
        products = await self.scrape_products(product_urls)
        
        end_time = time.time()
        duration = end_time - start_time
        
        # Generate final stats
        result = {
            'status': 'success',
            'merchant_id': MERCHANT_ID,
            'source': SOURCE,
            'total_urls_found': len(product_urls),
            'products_scraped': len(products),
            'products_skipped': len(product_urls) - len(products),
            'duration_seconds': duration,
            'output_file': str(self.output_file),
            'products_per_second': len(products) / duration if duration > 0 else 0
        }
        
        print(f"Scraping complete: {result}")
        return result

def main():
    parser = argparse.ArgumentParser(description="Simple Home Depot Scraper")
    parser.add_argument("--scrape-only", action="store_true", help="Only scrape, don't post-process")
    parser.add_argument("--limit", type=int, default=100, help="Maximum number of products to scrape")
    
    args = parser.parse_args()
    
    scraper = SimpleHomeDepotScraper(limit=args.limit)
    result = asyncio.run(scraper.run())
    
    print(f"Scraping completed: {result}")

if __name__ == "__main__":
    main()