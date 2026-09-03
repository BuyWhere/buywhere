"""
Home Depot US Final Scraper - Multi-proxy approach for bypassing bot detection
Target: 30K+ products using comprehensive proxy strategy
"""

import asyncio
import json
import re
import time
import argparse
import os
import urllib.parse
from typing import Any, List, Optional, Dict
from dataclasses import dataclass
import aiohttp
from pathlib import Path

DATA_DIR = Path("/home/paperclip/buywhere-api/data")
MERCHANT_ID = "homedepot_us"
SOURCE = "homedepot_us"
BASE_URL = "https://www.homedepot.com"

# Multiple user agents for rotation
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

class HomeDepotFinalScraper:
    def __init__(self, limit: int = 100000):
        self.limit = limit
        self.data_dir = DATA_DIR / MERCHANT_ID
        self.output_file = self.data_dir / "products.jsonl"
        self.scraped_urls = set()
        self.failed_urls = set()
        self.session = None
        
        # Statistics
        self.stats = {
            'total_requests': 0,
            'successful_requests': 0,
            'failed_requests': 0,
            'response_codes': {},
            'proxy_success': {},
            'discovery_method': {}
        }
        
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
    
    def _build_proxy_configs(self) -> List[Dict]:
        """Build multiple proxy configurations with fallback priorities."""
        configs = []
        
        # Get environment variables with defaults
        scraperapi_key = os.environ.get("SCRAPERAPI_KEY", "0832602ba87752788b2cd9ab6cef34df")
        
        # ScraperAPI configurations (highest priority)
        if scraperapi_key:
            configs.append({
                'name': 'scraperapi_ultra',
                'proxy': f"http://scraperapi:{scraperapi_key}@proxy.scraperapi.com:8080",
                'headers': {
                    **get_random_headers(),
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                }
            })
            
            configs.append({
                'name': 'scraperapi_premium',
                'proxy': f"http://scraperapi:{scraperapi_key}@premium.proxy.scraperapi.com:8080",
                'headers': get_random_headers()
            })
        
        # BrightData configuration (secondary priority)
        brightdata_username = os.environ.get("BRIGHTDATA_RESIDENTIAL_USERNAME", "brd-customer-hl_3ab737be-zone-residential_proxy_01")
        brightdata_password = os.environ.get("BRIGHTDATA_RESIDENTIAL_PASSWORD", "0sdt2q30mo7f")
        
        if brightdata_username and brightdata_password:
            encoded_user = urllib.parse.quote(brightdata_username, safe="")
            encoded_pass = urllib.parse.quote(brightdata_password, safe="")
            configs.append({
                'name': 'brightdata',
                'proxy': f"http://{encoded_user}:{encoded_pass}@brd.superproxy.io:33335",
                'headers': get_random_headers()
            })
        
        return configs
    
    async def fetch_with_retry(self, url: str, max_retries: int = 5) -> Optional[str]:
        """Fetch URL with multiple proxy fallback and retry logic."""
        proxy_configs = self._build_proxy_configs()
        
        for attempt in range(max_retries):
            # Try different proxy configurations
            for proxy_config in proxy_configs:
                try:
                    print(f"Attempt {attempt + 1}/{max_retries} using {proxy_config['name']} for {url}")
                    
                    self.stats['total_requests'] += 1
                    
                    # Create session with proxy
                    connector = aiohttp.TCPConnector(limit=100, ttl_dns_cache=300, ssl=False)
                    
                    async with aiohttp.ClientSession(
                        connector=connector,
                        timeout=aiohttp.ClientTimeout(total=45, connect=15),
                        headers=proxy_config['headers']
                    ) as session:
                        
                        async with session.get(url, proxy=proxy_config['proxy'], timeout=45) as response:
                            self.stats['response_codes'][str(response.status)] = self.stats['response_codes'].get(str(response.status), 0) + 1
                            
                            if response.status == 200:
                                self.stats['successful_requests'] += 1
                                self.stats['proxy_success'][proxy_config['name']] = self.stats['proxy_success'].get(proxy_config['name'], 0) + 1
                                return await response.text()
                            elif response.status == 403:
                                print(f"Access denied for {url} (403) with {proxy_config['name']}")
                                await asyncio.sleep(4)  # Longer delay for 403
                                continue
                            elif response.status == 429:
                                wait_time = min(60, 2 ** attempt)
                                print(f"Rate limited (429), waiting {wait_time}s")
                                await asyncio.sleep(wait_time)
                                continue
                            else:
                                print(f"Failed to fetch {url}: HTTP {response.status} with {proxy_config['name']}")
                                break  # Try next proxy
                                
                except Exception as e:
                    print(f"Error fetching {url} with {proxy_config['name']}: {e}")
                    self.stats['failed_requests'] += 1
                    continue
            
            # Wait before next attempt with different proxy
            wait_time = min(30, (attempt + 1) * 5)
            print(f"All proxy attempts failed for {url}, waiting {wait_time}s before retry...")
            await asyncio.sleep(wait_time)
        
        return None
    
    async def discover_product_urls(self) -> List[str]:
        """Discover product URLs using multiple methods."""
        all_urls = []
        
        # Method 1: Sitemap Discovery
        print("Method 1: Sitemap discovery...")
        sitemap_urls = await self._discover_sitemap_urls()
        for sitemap_url in sitemap_urls:
            product_urls = await self._extract_urls_from_sitemap(sitemap_url)
            all_urls.extend(product_urls)
            for url in product_urls:
                self.stats['discovery_method'][url] = 'sitemap'
        
        # Method 2: Category Discovery
        print("Method 2: Category discovery...")
        category_urls = await self._discover_category_urls()
        all_urls.extend(category_urls)
        for url in category_urls:
            self.stats['discovery_method'][url] = 'category'
        
        # Method 3: Search Discovery
        print("Method 3: Search discovery...")
        search_urls = await self._discover_search_urls()
        all_urls.extend(search_urls)
        for url in search_urls:
            self.stats['discovery_method'][url] = 'search'
        
        # Remove duplicates and filter
        unique_urls = list(set([url for url in all_urls if self._is_valid_product_url(url)]))
        print(f"Total unique product URLs discovered: {len(unique_urls)}")
        
        return unique_urls[:self.limit]
    
    async def _discover_sitemap_urls(self) -> List[str]:
        """Discover sitemap URLs."""
        sitemap_locations = [
            "/sitemap.xml",
            "/sitemap_products.xml", 
            "/sitemap_index.xml",
            "/sitemaps/sitemap_index.xml",
            "/sitemaps/pdp-sitemap-index.xml",
            "/sitemaps/product-sitemap.xml",
            "/robots.txt"
        ]
        
        found_sitemaps = []
        
        for location in sitemap_locations:
            sitemap_url = f"{BASE_URL}{location}"
            try:
                html = await self.fetch_with_retry(sitemap_url)
                if html and ("<urlset" in html or "<sitemapindex" in html or "Sitemap:" in html):
                    found_sitemaps.append(sitemap_url)
                    print(f"Found sitemap: {sitemap_url}")
                    break
            except:
                continue
        
        return found_sitemaps
    
    async def _extract_urls_from_sitemap(self, sitemap_url: str) -> List[str]:
        """Extract product URLs from sitemap."""
        try:
            html = await self.fetch_with_retry(sitemap_url)
            if not html:
                return []
            
            # Handle gzip compression
            if html.startswith("\x1f\x8b"):
                import gzip
                try:
                    html = gzip.decompress(html).decode('utf-8')
                except:
                    return []
            
            # Parse XML
            import xml.etree.ElementTree as ET
            root = ET.fromstring(html)
            
            product_urls = []
            namespaces = {
                '': 'http://www.sitemaps.org/schemas/sitemap/0.9',
                'sitemap': 'http://www.sitemaps.org/schemas/sitemap/0.9'
            }
            
            for ns in namespaces.values():
                for loc in root.findall(f".//{ns}url/{ns}loc"):
                    if loc.text and self._is_valid_product_url(loc.text):
                        product_urls.append(loc.text)
            
            return product_urls
            
        except Exception as e:
            print(f"Error parsing sitemap: {e}")
            return []
    
    async def _discover_category_urls(self) -> List[str]:
        """Discover product URLs from category pages."""
        categories = [
            "/s/tools", "/s/power+tools", "/s/hand+tools", "/s/plumbing", 
            "/s/electrical", "/s/paint", "/s/lumber", "/s/lighting",
            "/s/appliances", "/s/flooring", "/s/hardware", "/s/kitchen",
            "/s/bathroom", "/s/outdoor", "/s/garden", "/s/storage",
            "/s/organization", "/s/lighting+fixtures", "/s/ceiling+fans",
            "/s/windows", "/s/doors", "/s/building+materials", "/s/tools/power+tools/page"
        ]
        
        all_urls = []
        
        for category in categories:
            page = 1
            attempts = 0
            
            while attempts < 3 and page <= 5:  # Limit to 5 pages per category
                category_url = f"{BASE_URL}{category}?page={page}" if page > 1 else f"{BASE_URL}{category}"
                
                html = await self.fetch_with_retry(category_url)
                if html:
                    product_urls = self._extract_product_urls_from_page(html)
                    new_urls = [url for url in product_urls if url not in all_urls]
                    all_urls.extend(new_urls)
                    
                    print(f"Category {category}, page {page}: {len(new_urls)} new products")
                    
                    if len(new_urls) == 0:
                        break
                    
                    page += 1
                    attempts = 0
                    await asyncio.sleep(3.0)  # Rate limiting
                else:
                    attempts += 1
                    await asyncio.sleep(5.0)
        
        return all_urls
    
    async def _discover_search_urls(self) -> List[str]:
        """Discover product URLs using search terms."""
        search_terms = [
            "tools", "power tools", "hand tools", "plumbing", "electrical",
            "paint", "lumber", "lighting", "appliances", "flooring",
            "hardware", "kitchen", "bathroom", "outdoor", "garden",
            "storage", "organization", "lighting fixtures", "ceiling fans",
            "windows", "doors", "building materials", "home improvement",
            "construction", "maintenance", "cleaning supplies", "electrical supplies"
        ]
        
        all_urls = []
        
        for term in search_terms:
            if len(all_urls) >= self.limit:
                break
            
            search_url = f"{BASE_URL}/s/{term}"
            html = await self.fetch_with_retry(search_url)
            
            if html:
                product_urls = self._extract_product_urls_from_page(html)
                new_urls = [url for url in product_urls if url not in all_urls]
                all_urls.extend(new_urls)
                
                print(f"Search '{term}': {len(new_urls)} new products")
                
                # Rate limiting
                await asyncio.sleep(2.0)
        
        return all_urls
    
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
    
    def _is_valid_product_url(self, url: str) -> bool:
        """Check if URL is a valid Home Depot product page."""
        return bool(re.search(r"/p/[A-Za-z0-9\-/]+\.html$", url))
    
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
        """Scrape all product URLs with batch processing."""
        products = []
        
        # Process in batches of 20 URLs
        for batch_start in range(0, len(urls), 20):
            batch_urls = urls[batch_start:batch_start + 20]
            print(f"Processing batch {batch_start//20 + 1}: URLs {batch_start + 1}-{min(batch_start + 20, len(urls))}")
            
            batch_products = []
            for i, url in enumerate(batch_urls):
                if url in self.scraped_urls:
                    print(f"Skipping already scraped URL: {url}")
                    continue
                
                print(f"Scraping {i+1}/{len(batch_urls)} in batch: {url}")
                
                product = await self.scrape_product_page(url)
                if product:
                    batch_products.append(product)
                    self.scraped_urls.add(url)
                    
                    # Save product immediately
                    await self._save_product(product)
                    
                    print(f"✓ Successfully scraped: {product.title}")
                else:
                    self.failed_urls.add(url)
                    print(f"✗ Failed to scrape: {url}")
                
                # Rate limiting within batch
                await asyncio.sleep(3.0)
            
            products.extend(batch_products)
            
            # Longer delay between batches
            print(f"Batch completed: {len(batch_products)} products scraped")
            if batch_start + 20 < len(urls):
                await asyncio.sleep(15.0)
        
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
        print(f"=== Starting Home Depot Final Scraper ===")
        print(f"Target: {self.limit} products")
        print(f"Using multiple proxy configurations")
        print(f"=========================================")
        
        # Step 1: Discover product URLs
        print("\nStep 1: Discovering product URLs...")
        product_urls = await self.discover_product_urls()
        
        if not product_urls:
            print("No product URLs found, cannot proceed")
            return {
                'status': 'error',
                'message': 'No product URLs found',
                'products_scraped': 0,
                'stats': self.stats
            }
        
        print(f"Discovered {len(product_urls)} product URLs")
        
        # Step 2: Scrape products
        print("\nStep 2: Scraping products...")
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
            'failed_urls_count': len(self.failed_urls),
            'duration_seconds': duration,
            'output_file': str(self.output_file),
            'products_per_second': len(products) / duration if duration > 0 else 0,
            'stats': self.stats
        }
        
        print(f"\n=== Scraping Complete ===")
        print(f"Products scraped: {len(products)}")
        print(f"Failed URLs: {len(self.failed_urls)}")
        print(f"Duration: {duration:.2f} seconds")
        print(f"Success rate: {len(products) / len(product_urls) * 100:.1f}%")
        print(f"Output file: {self.output_file}")
        print(f"========================")
        
        return result

def main():
    parser = argparse.ArgumentParser(description="Home Depot US Final Scraper")
    parser.add_argument("--scrape-only", action="store_true", help="Only scrape, don't post-process")
    parser.add_argument("--limit", type=int, default=100000, help="Maximum number of products to scrape")
    
    args = parser.parse_args()
    
    scraper = HomeDepotFinalScraper(limit=args.limit)
    result = asyncio.run(scraper.run())
    
    print(f"\nFinal Result: {result}")

if __name__ == "__main__":
    main()