import asyncio, httpx, re, json, time, os

PROXY = "http://brd-customer-hl_3ab737be-zone-residential:o3feuq72olm5@brd.superproxy.io:33335"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

def extract_jsonld(html: str) -> list[dict]:
    products = []
    pattern = r'<script[^>]+type=["\x27]application/ld\+json["\x27][^>]*>(.*?)</script>'
    for s in re.findall(pattern, html, re.DOTALL | re.IGNORECASE):
        try:
            data = json.loads(s.strip())
            if isinstance(data, dict) and data.get("@type") == "Product":
                products.append(data)
        except Exception as e:
            print(f"  extract_jsonld exception: {e}")
    return products

def transform_product(jsonld: dict, product_id: str, url: str) -> dict | None:
    try:
        name = jsonld.get("name", "").strip()
        if not name: return None
        offers = jsonld.get("offers", [{}])[0] if isinstance(jsonld.get("offers"), list) else jsonld.get("offers", {})
        price = offers.get("price", 0)
        return {"sku": product_id, "title": name, "price": price, "url": url}
    except Exception as e:
        print(f"  transform_product exception: {e}")
        return None

async def fetch_product(client, pid, semaphore):
    url = f"https://www.walmart.com/ip/-/{pid}"
    async with semaphore:
        resp = await client.get(url)
        print(f"  {pid}: status={resp.status_code}, len={len(resp.text)}")
        if resp.status_code == 200 and len(resp.text) > 50000:
            jsonld_products = extract_jsonld(resp.text)
            print(f"    jsonld products: {len(jsonld_products)}")
            for jsonld in jsonld_products:
                if jsonld.get("@type") == "Product":
                    return transform_product(jsonld, pid, url)
        return None

async def main():
    client = httpx.AsyncClient(proxy=PROXY, timeout=30.0, verify=False, follow_redirects=True, headers=HEADERS)
    semaphore = asyncio.Semaphore(1)
    
    ids_to_scrape = ['17433259042', '17341464774', '16877067136', '8638602351', '5214417210', '17058109631']
    
    results = []
    for pid in ids_to_scrape:
        print(f"Fetching {pid}...")
        product = await fetch_product(client, pid, semaphore)
        if product:
            results.append(product)
            print(f"  SUCCESS: {product['title'][:40]}")
        else:
            print(f"  FAILED")
        await asyncio.sleep(1)
    
    print(f"\nTotal: {len(results)} products")
    for p in results:
        print(f"  {p['sku']}: {p['title'][:40]} - ${p['price']}")
    
    await client.aclose()
    
    # Write to file
    os.makedirs("/home/paperclip/buywhere/data", exist_ok=True)
    outfile = "/home/paperclip/buywhere/data/walmart_us_test.ndjson"
    with open(outfile, "w") as f:
        for p in results:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")
    print(f"Wrote {len(results)} products to {outfile}")

asyncio.run(main())