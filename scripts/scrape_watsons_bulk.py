"""
Watsons SG bulk scraper — sitemap-driven product enumeration via Brightdata proxy.
Uses the product sitemap to discover all BP codes, then scrapes individual pages.
"""
import asyncio, httpx, re, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

MERCHANT_ID = "watsons_sg"
BASE_URL = "https://www.watsons.com.sg"
OUTPUT_DIR = "/home/paperclip/buywhere-api/data/watsons_sg"
PROXY_URL = "http://brd-customer-hl_3ab737be-zone-residential:o3feuq72olm5@brd.superproxy.io:33335"
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-SG,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}


def extract_product_info(html: str, sku: str) -> dict | None:
    try:
        title_m = re.search(r"<title>([^<]+)</title>", html)
        if not title_m:
            return None
        title = re.sub(r"\s*\|\s*Watsons[^|]*$", "", title_m.group(1)).strip()
        price_m = re.search(r"S\$\s*([\d,]+(?:\.\d{2})?)", html)
        price = float(price_m.group(1).replace(",", "")) if price_m else 0.0
        img_m = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', html)
        img_url = img_m.group(1) if img_m else ""
        desc_m = re.search(r'<meta[^>]+name="description"[^>]+content="([^"]+)"', html)
        desc = desc_m.group(1) if desc_m else ""
        brand = ""
        known_brands = ["LA ROCHE-POSAY", "NEUTROGENA", "SENKA", "NIVEA", "VASELINE",
                       "DETTOL", "HEAD & SHOULDERS", "PANTENE", "OLAY", "AVEENO",
                       "BIODERMA", "CETAPHIL", "EUCERIN", "VICHY", "LANEIGE",
                       "GARNIER", "L'OREAL", "MAYBELLINE", "DOVE", "LUX"]
        for b in known_brands:
            if b in title.upper():
                brand = b
                break
        return {
            "sku": sku, "merchant_id": MERCHANT_ID, "title": title,
            "description": desc, "price": price, "currency": "SGD",
            "url": f"{BASE_URL}/p/{sku}", "image_url": img_url,
            "category": "watsons", "category_path": ["Watsons"],
            "brand": brand, "is_active": True, "in_stock": True,
            "metadata": {"source": MERCHANT_ID},
        }
    except Exception:
        return None


async def main():
    target = int(sys.argv[1]) if len(sys.argv) > 1 else 6000
    concurrency = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    print(f"Watsons SG Bulk Scraper — target={target}, concurrency={concurrency}")
    print(f"Proxy: {PROXY_URL[:50]}...")

    async with httpx.AsyncClient(proxy=PROXY_URL, verify=False, timeout=60.0) as client:
        print("[1/3] Fetching product sitemap...")
        resp = await client.get(f"{BASE_URL}/sitemap_prd_en_01.xml", headers=BROWSER_HEADERS)
        if resp.status_code != 200:
            print(f"FAIL: Sitemap returned {resp.status_code}")
            return 1
        codes = list(set(re.findall(r"/p/(BP_\d+)", resp.text)))
        print(f"  Found {len(codes)} unique BP codes from sitemap")

        if not codes:
            print("FAIL: No BP codes in sitemap")
            return 1

        os.makedirs(OUTPUT_DIR, exist_ok=True)
        outfile = f"{OUTPUT_DIR}/watsons_sg_bulk_{time.strftime('%Y%m%d_%H%M%S')}.ndjson"
        print(f"  Output: {outfile}")

        sem = asyncio.Semaphore(concurrency)
        scraped = 0
        seen_skus = set()
        start_time = time.time()
        batch = []

        async def scrape_one(sku):
            async with sem:
                try:
                    r = await client.get(f"{BASE_URL}/p/{sku}", headers=BROWSER_HEADERS, timeout=30.0)
                    if r.status_code != 200:
                        return None
                    return extract_product_info(r.text, sku)
                except Exception:
                    return None

        for i, sku in enumerate(codes):
            if scraped >= target:
                break
            product = await scrape_one(sku)
            if product and product["sku"] not in seen_skus:
                seen_skus.add(product["sku"])
                batch.append(product)
                scraped += 1
                if len(batch) >= 100:
                    with open(outfile, "a") as f:
                        for p in batch:
                            f.write(json.dumps(p, ensure_ascii=False) + "\n")
                    batch = []
            if i > 0 and i % 200 == 0:
                elapsed = time.time() - start_time
                rate = scraped / elapsed if elapsed > 0 else 0
                eta = (target - scraped) / rate if rate > 0 else 0
                print(f"  Progress: {i}/{len(codes)} codes, {scraped}/{target} scraped, "
                      f"{rate:.1f} prod/s, ETA: {eta:.0f}s")

        if batch:
            with open(outfile, "a") as f:
                for p in batch:
                    f.write(json.dumps(p, ensure_ascii=False) + "\n")

        elapsed = time.time() - start_time
        print(f"\nDONE: {scraped} products in {elapsed:.0f}s ({scraped/elapsed:.1f} prod/s)")
        print(f"  Output file: {outfile}")
    return 0


if __name__ == "__main__":
    exit(asyncio.run(main()))
