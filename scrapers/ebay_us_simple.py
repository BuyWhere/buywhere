#!/usr/bin/env python3
"""
Simple eBay US product scraper that works with proxy configuration
Extracts real product data (title, price, image_url, brand) from eBay category browse pages
"""

import argparse
import json
import os
import time
import requests
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
import random

# Configuration
MERCHANT_ID = "ebay_us"
SOURCE = "ebay_us"
BASE_URL = "https://www.ebay.com"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/ebay_us"
CURRENCY = "USD"
REGION = "us"
COUNTRY_CODE = "US"

# Use direct connection (no proxy) for testing
PROXY_CONFIG = None

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

CATEGORIES = [
    {"id": "electronics_computers", "name": "Electronics", "keyword": "computers laptops", "max_pages": 5},
    {"id": "electronics_phones", "name": "Electronics", "keyword": "smartphone mobile phone", "max_pages": 5},
    {"id": "fashion_women", "name": "Fashion", "keyword": "women clothing dress", "max_pages": 5},
    {"id": "fashion_men", "name": "Fashion", "keyword": "men clothing shirt", "max_pages": 5},
    {"id": "home_furniture", "name": "Home & Garden", "keyword": "furniture home decor", "max_pages": 5},
]

def extract_product_data(item):
    """Extract product data from eBay listing item"""
    try:
        # Extract title
        title_elem = item.find('h3', class_='s-item__title')
        title = title_elem.get_text(strip=True) if title_elem else ""
        
        # Extract price
        price_elem = item.find('span', class_='s-item__price')
        price_text = price_elem.get_text(strip=True) if price_elem else ""
        price = extract_price(price_text) if price_text else 0
        
        # Extract image URL
        img_elem = item.find('img', class_='s-item__image-img')
        image_url = img_elem.get('src') if img_elem else ""
        
        # Extract brand (from title or specific elements)
        brand = extract_brand(title) if title else ""
        
        # Calculate quality score
        quality_score = calculate_quality(title, price, image_url, brand)
        
        return {
            'id': generate_id(title),
            'title': title,
            'price': price,
            'currency': CURRENCY,
            'image_url': image_url,
            'brand': brand,
            'url': item.find('a', class_='s-item__link')['href'] if item.find('a', class_='s-item__link') else "",
            'merchant_id': MERCHANT_ID,
            'source': SOURCE,
            'category': extract_category(item),
            'region': REGION,
            'country_code': COUNTRY_CODE,
            'quality_score': quality_score,
            'scraped_at': datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        print(f"Error extracting product data: {e}")
        return None

def extract_price(price_text):
    """Extract price from price text"""
    try:
        # Remove currency symbols and extract numeric value
        import re
        price_match = re.search(r'[\d,]+\.?\d*', price_text.replace('$', '').replace(',', ''))
        if price_match:
            return float(price_match.group())
    except:
        pass
    return 0

def extract_brand(title):
    """Extract brand from product title"""
    if not title:
        return ""
    
    # Common brand indicators in titles
    brands = ['Apple', 'Samsung', 'Dell', 'HP', 'Sony', 'Nike', 'Adidas', 'Microsoft', 'Lenovo', 'ASUS']
    for brand in brands:
        if brand.lower() in title.lower():
            return brand
    
    # Extract first word as brand (simple heuristic)
    first_word = title.split()[0] if title.split() else ""
    return first_word if len(first_word) > 1 else ""

def extract_category(item):
    """Extract category from item"""
    category_elem = item.find('span', class_='s-item__dynamic s-item__dynamic__2')
    return category_elem.get_text(strip=True) if category_elem else ""

def generate_id(title):
    """Generate unique ID for product"""
    import hashlib
    return hashlib.md5(f"{title}{time.time()}".encode()).hexdigest()[:16]

def calculate_quality(title, price, image_url, brand):
    """Calculate quality score (0-100)"""
    score = 0
    
    # Title quality (0-30 points)
    if title and len(title) > 10:
        score += 20
        if len(title) > 20:
            score += 10
    
    # Price quality (0-30 points)
    if price > 0:
        score += 30
        if price > 10:
            score += 10
    
    # Image quality (0-20 points)
    if image_url and 'http' in image_url:
        score += 20
    
    # Brand quality (0-20 points)
    if brand and len(brand) > 1:
        score += 20
    
    return min(score, 100)

def scrape_category(category, max_pages):
    """Scrape products from a specific category"""
    print(f"Scraping category: {category['name']} - keyword: {category['keyword']}")
    
    all_products = []
    
    for page in range(1, max_pages + 1):
        try:
            search_url = f"{BASE_URL}/s/i.html?_nkw={category['keyword']}&_pgn={page}"
            print(f"  Page {page}... {search_url}")
            
            # Try with direct connection (no proxy for now)
            response = None
            try:
                if PROXY_CONFIG:
                    response = requests.get(search_url, headers=DEFAULT_HEADERS, proxies=PROXY_CONFIG, timeout=30, verify=False)
                    print(f"  Proxy request sent to eBay...")
                else:
                    response = requests.get(search_url, headers=DEFAULT_HEADERS, timeout=30, verify=False)
                    print(f"  Direct connection request sent to eBay...")
            except Exception as error:
                print(f"  Request failed ({error})")
                continue
            
            if response and response.status_code == 200:
                soup = BeautifulSoup(response.content, 'html.parser')
                items = soup.find_all('li', class_='s-item')
                
                page_products = []
                for item in items:
                    product = extract_product_data(item)
                    if product:
                        page_products.append(product)
                
                all_products.extend(page_products)
                print(f"  Page {page}: Found {len(page_products)} products")
                
                # Random delay to avoid being blocked
                time.sleep(random.uniform(1, 3))
            else:
                print(f"  Page {page}: Failed to fetch ({response.status_code if response else 'No response'})")
                
        except Exception as e:
            print(f"  Page {page}: Error - {e}")
            continue
    
    return all_products

def save_products(products, category_id):
    """Save products to JSONL file"""
    if not products:
        print("No products to save")
        return
    
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{OUTPUT_DIR}/products_{category_id}_{timestamp}.jsonl"
    
    quality_stats = calculate_quality_stats(products)
    print(f"Quality stats: {quality_stats}")
    
    with open(filename, 'w') as f:
        for product in products:
            f.write(json.dumps(product) + '\n')
    
    print(f"Saved {len(products)} products to {filename}")
    return filename

def calculate_quality_stats(products):
    """Calculate quality statistics"""
    if not products:
        return {}
    
    total = len(products)
    price_gt_zero = sum(1 for p in products if p['price'] > 0)
    has_image = sum(1 for p in products if p['image_url'])
    has_brand = sum(1 for p in products if p['brand'])
    
    return {
        'total': total,
        'price_gt_zero': price_gt_zero,
        'price_gt_zero_pct': (price_gt_zero / total * 100) if total > 0 else 0,
        'has_image': has_image,
        'has_image_pct': (has_image / total * 100) if total > 0 else 0,
        'has_brand': has_brand,
        'has_brand_pct': (has_brand / total * 100) if total > 0 else 0,
    }

def main():
    parser = argparse.ArgumentParser(description='eBay US Product Scraper')
    parser.add_argument('--max-pages', type=int, default=2, help='Maximum pages per category')
    parser.add_argument('--scrape-only', action='store_true', help='Only scrape, don\'t save')
    parser.add_argument('--category', type=str, help='Specific category to scrape')
    
    args = parser.parse_args()
    
    print("Starting eBay US product scraper...")
    
    categories_to_scrape = []
    if args.category:
        for cat in CATEGORIES:
            if cat['id'] == args.category:
                categories_to_scrape = [cat]
                break
        if not categories_to_scrape:
            print(f"Category {args.category} not found")
            return
    else:
        categories_to_scrape = CATEGORIES
    
    all_products = []
    
    for category in categories_to_scrape:
        products = scrape_category(category, args.max_pages)
        all_products.extend(products)
        
        if not args.scrape_only and products:
            save_products(products, category['id'])
        
        # Small delay between categories
        time.sleep(2)
    
    if all_products:
        final_stats = calculate_quality_stats(all_products)
        print(f"\nFinal Results:")
        print(f"Total products scraped: {len(all_products)}")
        print(f"Price > 0: {final_stats['price_gt_zero_pct']:.1f}% ({final_stats['price_gt_zero']}/{final_stats['total']})")
        print(f"Has image: {final_stats['has_image_pct']:.1f}% ({final_stats['has_image']}/{final_stats['total']})")
        print(f"Has brand: {final_stats['has_brand_pct']:.1f}% ({final_stats['has_brand']}/{final_stats['total']})")
        
        # Check if we meet the acceptance criteria
        if (final_stats['price_gt_zero_pct'] >= 95 and 
            final_stats['has_image_pct'] >= 95 and 
            final_stats['has_brand_pct'] >= 95):
            print("✅ Acceptance criteria met: 95%+ quality across all metrics")
        else:
            print("❌ Acceptance criteria not met")
    else:
        print("No products were scraped successfully")

if __name__ == "__main__":
    main()