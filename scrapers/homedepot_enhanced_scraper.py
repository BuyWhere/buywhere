"""
Home Depot US Enhanced Scraper - Final production solution for Home Depot scraping.

Target: 30K+ products using multiple proxy services and advanced techniques.
Key Features:
- Uses multiple proxy services (ScraperAPI + BrightData + direct proxy)
- Implements advanced anti-bot detection bypass techniques
- Comprehensive error handling and retry logic
- Multiple discovery strategies with fallback mechanisms
- Proper rate limiting and concurrency control
- Checkpoint/resume functionality

Usage:
    python3 homedepot_enhanced_scraper.py --scrape-only --limit 30000
"""

import asyncio
import json
import re
import time
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional, Set, Dict
from urllib.parse import urljoin, urlparse
import logging

import aiohttp
import os

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("homedepot_enhanced")

# Configuration
DATA_DIR = Path("/home/paperclip/buywhere-api/data")
MERCHANT_ID = "homedepot_us"
SOURCE = "homedepot_us"
BASE_URL = "https://www.homedepot.com"
PRODUCT_BASE = BASE_URL

# Proxy configurations
SCRAPERAPI_KEY = os.environ.get("SCRAPERAPI_KEY", "0832602ba87752788b2cd9ab6cef34df")
BRIGHTDATA_USERNAME = os.environ.get("BRIGHTDATA_USERNAME", "brd-customer-hl_3ab737be-zone-residential_proxy_01")
BRIGHTDATA_PASSWORD = os.environ.get("BRIGHTDATA_PASSWORD", "0sdt2q30mo7f")
BRIGHTDATA_HOST = os.environ.get("BRIGHTDATA_HOST", "brd.superproxy.io")
BRIGHTDATA_PORT = os.environ.get("BRIGHTDATA_PORT", "33335")

# Advanced user agents for rotation
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
]

# Enhanced headers to mimic real browser
ENHANCED_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
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
    "Accept-Charset": "UTF-8",
    "sec-ch-ua": '"Chromium";v="125", "Not.A/Brand";v="24", "Google Chrome";v="125"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-ch-ua-bitness": '"64"',
    "Priority": "u=0, i",
}

# Product discovery URLs - expanded for better coverage
CATEGORY_URLS = [
    f"{BASE_URL}/s/tools/power-tools",
    f"{BASE_URL}/s/tools/cordless-drills",
    f"{BASE_URL}/s/tools/circular-saws",
    f"{BASE_URL}/s/tools/hand-tools",
    f"{BASE_URL}/s/tools/screwdrivers",
    f"{BASE_URL}/s/tools/hammers",
    f"{BASE_URL}/s/tools/wrench-sets",
    f"{BASE_URL}/s/tools/sanders",
    f"{BASE_URL}/s/tools/nail-guns",
    f"{BASE_URL}/s/tools/air-compressors",
    f"{BASE_URL}/s/tools/routers",
    f"{BASE_URL}/s/tools/table-saws",
    f"{BASE_URL}/s/tools/miter-saws",
    f"{BASE_URL}/s/hardware/screws",
    f"{BASE_URL}/s/hardware/nails",
    f"{BASE_URL}/s/hardware/bolts",
    f"{BASE_URL}/s/hardware/locks",
    f"{BASE_URL}/s/hardware/shelves",
    f"{BASE_URL}/s/building/lumber",
    f"{BASE_URL}/s/building/plywood",
    f"{BASE_URL}/s/building/drywall",
    f"{BASE_URL}/s/paint/interior-paint",
    f"{BASE_URL}/s/plumbing/faucets",
    f"{BASE_URL}/s/electrical/light-fixtures",
    f"{BASE_URL}/s/flooring/hardwood",
    f"{BASE_URL}/s/hvac/air-conditioners",
    f"{BASE_URL}/s/storage/shelving",
    f"{BASE_URL}/s/kitchen/appliances",
    f"{BASE_URL}/s/bathroom/vanities",
    f"{BASE_URL}/s/garden/lawn-mowers",
    f"{BASE_URL}/s/lighting/ceiling-fans",
]

# Strategic search terms for discovery
SEARCH_TERMS = [
    "tools", "power tools", "hand tools", "plumbing", "electrical",
    "paint", "lumber", "lighting", "appliances", "flooring",
    "hardware", "kitchen", "bathroom", "outdoor", "garden",
    "storage", "organization", "lighting fixtures", "ceiling fans",
    "windows", "doors", "hardware tools", "building materials",
    "home improvement", "construction", "maintenance", "cleaning",
    "fans", "heaters", "air conditioners", "furnaces", "thermostats",
    "paint sprayers", "stains", "cements", "insulation", "roofing",
    "locks", "hinges", "hooks", "sprinklers", "hoses", "grills",
    "patio furniture", "plants", "seeds", "soil", "mulch",
    "safety equipment", "work gloves", "tool boxes", "storage sheds"
]

# Sitemap locations to check
SITEMAP_LOCATIONS = [
    "/sitemap.xml",
    "/sitemap_products.xml", 
    "/sitemap_index.xml",
    "/sitemaps/sitemap_index.xml",
    "/feed.xml",
    "/sitemap-products.xml",
    "/sitemap-categories.xml",
]

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
    scraped_at: str = ""
    
    def __post_init__(self):
        if self.specs is None:
            self.specs = {}
        if not self.scraped_at:
            self.scraped_at = datetime.now(timezone.utc).isoformat()

@dataclass
class ScrapeStats:
    total_urls: int = 0
    scraped: int = 0
    skipped: int = 0
    errors: int = 0
    retries: int = 0
    start_time: float = 0
    end_time: Optional[float] = None
    response_codes: Counter = None
    proxy_success: Dict[str, int] = None
    
    def __post_init__(self):
        if self.response_codes is None:
            self.response_codes = Counter()
        if self.proxy_success is None:
            self.proxy_success = defaultdict(int)

class HomeDepotEnhancedScraper:
    def __init__(self, limit: int = 30000):
        self.limit = limit
        self.data_dir = DATA_DIR / MERCHANT_ID
        self.output_file = self.data_dir / "products.jsonl"
        self.stats = ScrapeStats()
        self.session: Optional[aiohttp.ClientSession] = None
        self.scraped_urls: Set[str] = set()
        self.discovered_urls: Set[str] = set()
        self.proxy_method = "scraperapi"  # Current proxy method
        
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
    
    def _get_random_headers(self):
        """Get random headers to mimic different browsers."""
        import random
        headers = ENHANCED_HEADERS.copy()
        headers["User-Agent"] = random.choice(USER_AGENTS)
        return headers
    
    def _build_scraperapi_url(self, url: str, use_ultra: bool = True) -> str:
        """Build ScraperAPI URL with ultra_premium option."""
        options = "&render=true&render_js=false"
        if use_ultra:
            options += "&ultra_premium=true"
        return f"http://api.scraperapi.com?api_key={SCRAPERAPI_KEY}&url={url}{options}"
    
    def _build_brightdata_url(self, url: str) -> str:
        """Build BrightData proxy URL."""
        import urllib.parse
        username = urllib.parse.quote(BRIGHTDATA_USERNAME, safe="")
        password = urllib.parse.quote(BRIGHTDATA_PASSWORD, safe="")
        return f"http://{username}:{password}@{BRIGHTDATA_HOST}:{BRIGHTDATA_PORT}"
    
    def _build_proxy_config(self, url: str) -> Dict[str, Any]:
        """Build proxy configuration with multiple fallback options."""
        methods = [
            ("scraperapi", self._build_scraperapi_url(url, True)),
            ("scraperapi_normal", self._build_scraperapi_url(url, False)),
            ("brightdata", self._build_brightdata_url(url)),
        ]
        return methods
    
    async def fetch_with_retry(self, url: str, max_retries: int = 8) -> Optional[str]:
        """Fetch URL with advanced retry logic using multiple proxy methods."""
        
        # Try different proxy methods
        proxy_methods = self._build_proxy_config(url)
        
        for method_name, proxy_url in proxy_methods:
            if self.stats.proxy_success[method_name] > 0:
                # Skip methods that have failed before
                continue
                
            for attempt in range(3):  # 3 attempts per method
                try:
                    headers = self._get_random_headers()
                    
                    # Add exponential delay between attempts
                    delay = min(120, (attempt + 1) * 3)
                    logger.info(f"Trying {method_name} for {url} (attempt {attempt + 1}/3, delay: {delay}s)")
                    await asyncio.sleep(delay)
                    
                    if method_name == "brightdata":
                        # Use direct proxy
                        async with aiohttp.ClientSession(
                            timeout=aiohttp.ClientTimeout(total=180, connect=45),
                            headers=headers
                        ) as session:
                            async with session.get(url, proxy=proxy_url) as response:
                                self.stats.response_codes[response.status] += 1
                                
                                if response.status == 200:
                                    content = await response.text()
                                    if len(content) > 5000:
                                        self.stats.proxy_success[method_name] += 1
                                        return content
                    else:
                        # Use ScraperAPI
                        async with aiohttp.ClientSession(
                            timeout=aiohttp.ClientTimeout(total=180, connect=45),
                            headers=headers
                        ) as session:
                            async with session.get(proxy_url) as response:
                                self.stats.response_codes[response.status] += 1
                                
                                if response.status == 200:
                                    content = await response.text()
                                    if len(content) > 5000 and "error" not in content.lower():
                                        self.stats.proxy_success[method_name] += 1
                                        return content
                                
                                elif response.status == 403:
                                    logger.warning(f"Access denied for {url} (403), retrying...")
                                    continue
                                    
                                elif response.status == 429:
                                    wait_time = min(300, 2 ** attempt)  # Cap at 5 minutes
                                    logger.warning(f"Rate limited (429), waiting {wait_time}s")
                                    await asyncio.sleep(wait_time)
                                    continue
                                    
                                elif response.status == 500:
                                    logger.warning(f"Server error (500), retrying...")
                                    await asyncio.sleep(delay * 3)
                                    continue
                                    
                                else:
                                    logger.warning(f"Failed to fetch {url}: {response.status}")
                                    break
                    
                except asyncio.TimeoutError:
                    logger.warning(f"Timeout for {url} with {method_name}, retrying...")
                    self.stats.retries += 1
                    if attempt == 2:  # Last attempt for this method
                        break
                    await asyncio.sleep(delay * 2)
                    
                except Exception as e:
                    logger.error(f"Error fetching {url} with {method_name} (attempt {attempt + 1}): {e}")
                    self.stats.retries += 1
                    if attempt == 2:  # Last attempt for this method
                        break
                    await asyncio.sleep(delay * 2)
            
            # Try next proxy method
            continue
        
        logger.error(f"All proxy methods failed for {url}")
        return None
    
    async def discover_sitemap_urls(self) -> List[str]:
        """Discover sitemap URLs from multiple locations."""
        logger.info("Step 1: Discovering sitemap URLs...")
        found_sitemaps = []
        
        for location in SITEMAP_LOCATIONS:
            sitemap_url = f"{BASE_URL}{location}"
            logger.info(f"Checking sitemap: {sitemap_url}")
            
            html = await self.fetch_with_retry(sitemap_url)
            if html:
                # Check if it's actually a sitemap
                if "<urlset" in html or "<sitemapindex" in html:
                    found_sitemaps.append(sitemap_url)
                    logger.info(f"Found sitemap: {sitemap_url}")
                    break
        
        logger.info(f"Found {len(found_sitemaps)} sitemaps")
        return found_sitemaps
    
    def extract_product_urls_from_sitemap(self, sitemap_content: str) -> List[str]:
        """Extract product URLs from sitemap content."""
        try:
            # Handle potential gzip compression
            if sitemap_content.startswith("\x1f\x8b"):
                import gzip
                try:
                    sitemap_content = gzip.decompress(sitemap_content).decode('utf-8')
                except:
                    return []
            
            # Parse XML
            root = ET.fromstring(sitemap_content)
            
            product_urls = []
            namespaces = {
                '': 'http://www.sitemaps.org/schemas/sitemap/0.9',
                'sitemap': 'http://www.sitemaps.org/schemas/sitemap/0.9'
            }
            
            for ns in namespaces.values():
                for loc in root.findall(f".//{ns}url/{ns}loc"):
                    if loc.text:
                        url = loc.text.strip()
                        if self._is_product_url(url):
                            product_urls.append(url)
            
            return product_urls
            
        except Exception as e:
            logger.error(f"Error parsing sitemap: {e}")
            return []
    
    async def fetch_category_urls(self) -> List[str]:
        """Fetch category pages and extract product URLs."""
        logger.info("Step 2: Fetching category URLs...")
        all_urls = []
        
        for category_url in CATEGORY_URLS:
            if len(all_urls) >= self.limit:
                break
                
            logger.info(f"Fetching category: {category_url}")
            
            html = await self.fetch_with_retry(category_url)
            if html:
                product_urls = self._extract_product_urls_from_page(html, category_url)
                new_urls = [url for url in product_urls if url not in self.discovered_urls]
                all_urls.extend(new_urls)
                self.discovered_urls.update(new_urls)
                logger.info(f"Found {len(new_urls)} new products in {category_url}")
            else:
                logger.warning(f"Failed to fetch category {category_url}")
            
            # Delay between category requests
            await asyncio.sleep(3.0)
        
        logger.info(f"Found {len(all_urls)} product URLs from categories")
        return all_urls[:self.limit]
    
    async def discover_search_urls(self) -> List[str]:
        """Discover product URLs using search-based approach."""
        logger.info("Step 3: Discovering product URLs via search...")
        all_urls = []
        
        for term in SEARCH_TERMS:
            if len(all_urls) >= self.limit:
                break
                
            search_url = f"{BASE_URL}/s/{term.replace(' ', '+')}"
            logger.info(f"Searching for '{term}' at {search_url}")
            
            html = await self.fetch_with_retry(search_url)
            if html:
                product_urls = self._extract_product_urls_from_page(html, search_url)
                new_urls = [url for url in product_urls if url not in self.discovered_urls]
                all_urls.extend(new_urls)
                self.discovered_urls.update(new_urls)
                logger.info(f"Found {len(new_urls)} new products for '{term}'")
            else:
                logger.warning(f"Failed to fetch search for '{term}'")
            
            # Delay between searches
            await asyncio.sleep(2.0)
        
        logger.info(f"Found {len(all_urls)} product URLs from search")
        return all_urls[:self.limit]
    
    def _extract_product_urls_from_page(self, html: str, ref_url: str) -> List[str]:
        """Extract product URLs from a page."""
        product_urls = []
        
        # Multiple patterns to find product URLs
        patterns = [
            r'href="(/p/[A-Za-z0-9\-/]+\.html)"',
            r'href="(/p/[A-Za-z0-9\-/]+)"',
            r'href="(https://www\.homedepot\.com/p/[A-Za-z0-9\-/]+\.html)"',
            r'href="(https://www\.homedepot\.com/p/[A-Za-z0-9\-/]+)"',
            r'"/p/[A-Za-z0-9\-/]+\.html"',
            r'"/p/[A-Za-z0-9\-/]+"',
        ]
        
        for pattern in patterns:
            matches = re.findall(pattern, html, re.IGNORECASE)
            for match in matches:
                if match.startswith('/p/'):
                    full_url = urljoin(BASE_URL, match)
                    if full_url not in product_urls:
                        product_urls.append(full_url)
                elif match.startswith('http'):
                    if match not in product_urls:
                        product_urls.append(match)
        
        # Clean and filter URLs
        clean_urls = []
        for url in product_urls:
            if self._is_product_url(url):
                clean_urls.append(url)
        
        return clean_urls
    
    def _is_product_url(self, url: str) -> bool:
        """Check if URL is a valid Home Depot product page."""
        return bool(re.search(r"/p/[A-Za-z0-9\-/]+\.html$", url)) and len(url) > 30
    
    def extract_product_data(self, html: str, url: str) -> ProductData:
        """Extract product data from HTML using advanced patterns."""
        product = ProductData(url=url)
        
        # Extract title
        title_patterns = [
            r'<h1[^>]*class="[^"]*product[^"]*"[^>]*>(.*?)</h1>',
            r'<title[^>]*>(.*?)</title>',
            r'<h1[^>]*>(.*?)</h1>',
            r'<h2[^>]*class="[^"]*product[^"]*"[^>]*>(.*?)</h2>',
        ]
        
        for pattern in title_patterns:
            match = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
            if match:
                product.title = re.sub(r'<[^>]+>', '', match.group(1)).strip()
                break
        
        # Extract price - multiple patterns
        price_patterns = [
            r'class="[^"]*price[^"]*"[^>]*>([\d,]+\.?\d*)',
            r'itemprop="price"[^>]*>([\d,]+\.?\d*)',
            r'"price"[^>]*:[^>]*"([^"]+)"',
            r'price[^>]*:[^>]*([0-9,]+\.?[0-9]*)',
        ]
        
        for pattern in price_patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                product.price = match.group(1).strip()
                break
        
        # Extract brand
        brand_patterns = [
            r'class="[^"]*brand[^"]*"[^>]*>([^<]+)',
            r'"brand"[^>]*:[^>]*"([^"]+)"',
            r'"brandName"[^>]*>([^<]+)',
        ]
        
        for pattern in brand_patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                product.brand = match.group(1).strip()
                break
        
        # Extract description
        desc_patterns = [
            r'class="[^"]*description[^"]*"[^>]*>([^<]+)',
            r'<meta[^>]*name="description"[^>]*content="([^"]+)"',
            r'"description"[^>]*:[^>]*"([^"]+)"',
        ]
        
        for pattern in desc_patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                product.description = match.group(1).strip()[:2000]
                break
        
        # Extract image URL
        img_patterns = [
            r'<img[^>]*class="[^"]*product[^"]*"[^>]*src="(.*?)"[^>]*>',
            r'<img[^>]*class="[^"]*image[^"]*"[^>]*src="(.*?)"[^>]*>',
            r'"image"[^>]*:[^>]*"([^"]+)"',
        ]
        
        for pattern in img_patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                product.image_url = urljoin(BASE_URL, match.group(1))
                break
        
        return product
    
    async def scrape_product(self, url: str) -> Optional[ProductData]:
        """Scrape a single product page."""
        try:
            html = await self.fetch_with_retry(url)
            if not html:
                return None
            
            product = self.extract_product_data(html, url)
            if product.title:
                return product
            else:
                logger.warning(f"Could not extract title from {url}")
                return None
                
        except Exception as e:
            logger.error(f"Error scraping {url}: {e}")
            return None
    
    async def scrape_products_batch(self, urls: List[str]) -> List[ProductData]:
        """Scrape products in batches with proper concurrency control."""
        products = []
        
        # Process URLs in batches to avoid overwhelming
        batch_size = 25  # Reduced for more careful processing
        for i in range(0, len(urls), batch_size):
            batch_urls = urls[i:i + batch_size]
            logger.info(f"Processing batch {i//batch_size + 1}: {len(batch_urls)} URLs")
            
            batch_products = []
            for url in batch_urls:
                if url in self.scraped_urls:
                    self.stats.skipped += 1
                    continue
                
                logger.info(f"Scraping product: {url}")
                
                product = await self.scrape_product(url)
                if product:
                    batch_products.append(product)
                    self.stats.scraped += 1
                    self.scraped_urls.add(url)
                    
                    # Save product immediately
                    await self._save_product(product)
                else:
                    self.stats.errors += 1
                
                # Rate limiting
                await asyncio.sleep(2.0)  # Increased delay
            
            products.extend(batch_products)
            
            # Progress update
            logger.info(f"Batch complete: {len(batch_products)}/{len(batch_urls)} products scraped")
            
            # Delay between batches
            if i + batch_size < len(urls):
                await asyncio.sleep(10.0)  # Longer delay between batches
        
        return products
    
    async def _save_product(self, product: ProductData):
        """Save a single product to the JSONL file."""
        with open(self.output_file, 'a', encoding='utf-8') as f:
            json.dump(asdict(product), f, ensure_ascii=False)
            f.write('\n')
    
    async def run(self) -> dict[str, Any]:
        """Run the scraper with comprehensive discovery and scraping."""
        self.stats.start_time = time.time()
        logger.info(f"Starting Home Depot Enhanced Scraper with limit {self.limit}")
        
        # Create HTTP session
        connector = aiohttp.TCPConnector(limit=50, ttl_dns_cache=300, ssl=False)
        timeout = aiohttp.ClientTimeout(total=180, connect=45)
        
        async with aiohttp.ClientSession(
            connector=connector,
            timeout=timeout,
            headers=self._get_random_headers()
        ) as session:
            self.session = session
            
            # Step 1: Discover sitemap URLs
            sitemap_urls = await self.discover_sitemap_urls()
            
            # Step 2: Extract product URLs from sitemaps
            sitemap_products = []
            if sitemap_urls:
                logger.info("Step 3: Extracting product URLs from sitemaps...")
                for sitemap_url in sitemap_urls:
                    html = await self.fetch_with_retry(sitemap_url)
                    if html:
                        products = self.extract_product_urls_from_sitemap(html)
                        sitemap_products.extend(products)
                        self.discovered_urls.update(products)
                        logger.info(f"Extracted {len(products)} products from sitemap")
            
            # Step 3: Fetch category URLs
            category_products = await self.fetch_category_urls()
            
            # Step 4: Discover search URLs
            search_products = await self.discover_search_urls()
            
            # Combine all discovered URLs
            all_urls = list(set(sitemap_products + category_products + search_products))
            self.stats.total_urls = len(all_urls)
            
            logger.info(f"Total unique product URLs discovered: {len(all_urls)}")
            
            if not all_urls:
                logger.error("No product URLs found")
                return self._get_result()
            
            # Limit to target number
            urls_to_scrape = all_urls[:self.limit]
            logger.info(f"Will scrape {len(urls_to_scrape)} products")
            
            # Step 5: Scrape products
            logger.info("Step 4: Scraping products...")
            products = await self.scrape_products_batch(urls_to_scrape)
        
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
            'status': 'success' if self.stats.scraped > 0 else 'error',
            'merchant_id': MERCHANT_ID,
            'source': SOURCE,
            'total_urls_found': self.stats.total_urls,
            'products_scraped': self.stats.scraped,
            'products_skipped': self.stats.skipped,
            'errors': self.stats.errors,
            'retries': self.stats.retries,
            'duration_seconds': duration,
            'output_file': str(self.output_file),
            'products_per_second': self.stats.scraped / duration if duration > 0 else 0,
            'response_codes': dict(self.stats.response_codes),
            'proxy_success': dict(self.stats.proxy_success)
        }

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Home Depot US Enhanced Scraper")
    parser.add_argument("--scrape-only", action="store_true", help="Only scrape, don't post-process")
    parser.add_argument("--limit", type=int, default=30000, help="Maximum number of products to scrape")
    parser.add_argument("--output", help="Output file path")
    
    args = parser.parse_args()
    
    scraper = HomeDepotEnhancedScraper(limit=args.limit)
    result = asyncio.run(scraper.run())
    
    print(f"Scraping completed: {result}")

if __name__ == "__main__":
    main()
