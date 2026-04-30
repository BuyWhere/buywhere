import asyncio
import cloudscraper
import re
import json

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-TH,en;q=0.9,th;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
}

def build_scraperapi_url(url: str, api_key: str, render: bool = True) -> str:
    params = f"api_key={api_key}&url={url}&country_code=TH&render=true"
    if render:
        params += "&ultra_premium=true"
    return f"http://api.scraperapi.com/?{params}"

async def _fetch_page(url: str, api_key: str) -> str | None:
    scraperapi_url = build_scraperapi_url(url, api_key, render=True)
    client = cloudscraper.create_scraper(browser={"browser": "chrome", "platform": "windows", "desktop": True}, delay=10)
    try:
        resp = client.get(scraperapi_url, timeout=60.0)
        if resp.status_code == 200 and len(resp.text) > 1000:
            return resp.text
    except Exception as e:
        print(f"Fetch error: {e}")
    return None

def extract_products_from_html(html: str) -> list[dict]:
    products = []
    
    script_match = re.search(r'<script[^>]*>([^<]*initialData[^<]*)</script>', html, re.DOTALL)
    if not script_match:
        print('No script match')
        return products
    
    script_content = script_match.group(1)
    init_pos = script_content.find('initialData')
    if init_pos < 0:
        print('No initialData')
        return products
    
    json_start = script_content.find('{', init_pos)
    json_text = script_content[json_start:json_start + 500000]
    
    hits_pattern = re.search(r'\\"hits\\"\s*:\s*\[', json_text)
    if not hits_pattern:
        print('No hits pattern')
        return products
    
    print(f'Found hits at offset {hits_pattern.start()}')
    hits_start = hits_pattern.start()
    depth = 0
    in_string = False
    escape = False
    array_chars = []
    
    for c in json_text[hits_start:]:
        if escape:
            escape = False
            array_chars.append(c)
            continue
        if c == '\\':
            escape = True
            array_chars.append(c)
            continue
        if c == '"':
            in_string = not in_string
            array_chars.append(c)
            continue
        if in_string:
            array_chars.append(c)
            continue
        if c in '{[':
            depth += 1
            array_chars.append(c)
        elif c == '}':
            depth -= 1
            array_chars.append(c)
            if depth == 0:
                break
        else:
            array_chars.append(c)
    
    hits_json = ''.join(array_chars)
    print(f'Extracted array length: {len(hits_json)}')
    
    try:
        hits = json.loads(hits_json)
        print(f'Parsed {len(hits)} products!')
        for h in hits[:3]:
            print(f'  SKU: {h.get("sku")}, name_en: {h.get("name_en","")[:50]}')
        return hits
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        print(f'Parse error: {e}')
        return []

async def main():
    url = "https://www.central.co.th/en/beauty"
    api_key = "0832602ba87752788b2cd9ab6cef34df"
    
    # Test direct cloudscraper (not via ScraperAPI)
    scraper = cloudscraper.create_scraper(browser={"browser": "chrome", "platform": "windows", "desktop": True}, delay=10)
    print("Testing direct cloudscraper...")
    resp = scraper.get(url, timeout=60.0)
    print(f"Direct response: {resp.status_code}, length: {len(resp.text)}")
    products = extract_products_from_html(resp.text)
    print(f"Direct products: {len(products)}")
    
    # Test via ScraperAPI
    print("\nTesting ScraperAPI...")
    html = await _fetch_page(url, api_key)
    if html:
        print(f"ScraperAPI response length: {len(html)}")
        products = extract_products_from_html(html)
        print(f"ScraperAPI products: {len(products)}")
    else:
        print("ScraperAPI returned None")

asyncio.run(main())