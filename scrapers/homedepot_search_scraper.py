"""
Home Depot US search-based scraper - proxy-free approach
Target: 30K+ products using search-based URL discovery
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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
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

class HomeDepotSearchScraper:
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
        """Fetch URL with retry logic and random headers."""
        headers = get_random_headers()
        
        for attempt in range(max_retries):
            try:
                print(f"Attempt {attempt + 1}/{max_retries} for {url}")
                
                # Add delay between attempts
                delay = (attempt + 1) * 2
                await asyncio.sleep(delay)
                
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, headers=headers, timeout=30) as response:
                        if response.status == 200:
                            return await response.text()
                        elif response.status == 403:
                            print(f"Access denied for {url} (403), retrying...")
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
    
    async def discover_product_urls_from_search(self) -> List[str]:
        """Discover product URLs using search-based approach."""
        # Strategic search terms that should return many products
        search_terms = [
            "tools", "power tools", "hand tools", "plumbing", "electrical",
            "paint", "lumber", "lighting", "appliances", "flooring",
            "hardware", "kitchen", "bathroom", "outdoor", "garden",
            "storage", "organization", "lighting fixtures", "ceiling fans",
            "windows", "doors", "hardware tools", "building materials",
            "home improvement", "construction", "maintenance", "cleaning"
        ]
        
        all_product_urls = []
        
        for term in search_terms:
            if len(all_product_urls) >= self.limit:
                break
            
            search_url = f"{BASE_URL}/s/{term}"
            print(f"Searching for '{term}' at {search_url}")
            
            html = await self.fetch_with_retry(search_url)
            if not html:
                continue
            
            # Extract product URLs from search results
            product_urls = self._extract_product_urls_from_page(html)
            new_urls = [url for url in product_urls if url not in self.scraped_urls and url not in all_product_urls]
            
            all_product_urls.extend(new_urls)
            print(f"Found {len(new_urls)} new products for '{term}'")
            
            # Add delay between searches
            await asyncio.sleep(2.0)
        
        print(f"Total unique product URLs discovered: {len(all_product_urls)}")
        return all_product_urls[:self.limit]
    
    def _extract_product_urls_from_page(self, html: str) -> List[str]:
        """Extract product URLs from a page."""
        product_urls = []
        
        # Pattern to match product URLs
        product_pattern = r'href="(/p/[A-Za-z0-9\-/]+\.html)"'
        matches = re.findall(product_pattern, html)
        
        for match in matches:
            full_url = f"{BASE_URL}{match}"
            product_urls.append(full_url)
        
        return product_urls
    
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
                
                print(f"Successfully scraped: {product.title}")
            else:
                print(f"Failed to scrape: {url}")
            
            # Rate limiting
            await asyncio.sleep(1.0)
            
            # Progress update
            if (i + 1) % 50 == 0:
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
        print(f"Starting Home Depot search scraper with limit {self.limit}")
        
        # Step 1: Discover product URLs using search
        print("Step 1: Discovering product URLs via search...")
        product_urls = await self.discover_product_urls_from_search()
        
        if not product_urls:
            print("No product URLs found via search")
            return {
                'status': 'error',
                'message': 'No product URLs found',
                'products_scraped': 0
            }
        
        print(f"Discovered {len(product_urls)} product URLs to scrape")
        
        # Step 2: Scrape products
        print("Step 2: Scraping products...")
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
    parser = argparse.ArgumentParser(description="Home Depot US search scraper")
    parser.add_argument("--scrape-only", action="store_true", help="Only scrape, don't post-process")
    parser.add_argument("--limit", type=int, default=100000, help="Maximum number of products to scrape")
    
    args = parser.parse_args()
    
    scraper = HomeDepotSearchScraper(limit=args.limit)
    result = asyncio.run(scraper.run())
    
    print(f"Scraping completed: {result}")

if __name__ == "__main__":
    main()