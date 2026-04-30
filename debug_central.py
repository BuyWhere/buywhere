import asyncio, httpx, re, json

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-TH,en;q=0.9,th;q=0.8",
}
API_KEY = "0832602ba87752788b2cd9ab6cef34df"

def build_url(url):
    params = f"api_key={API_KEY}&url={url}&country_code=TH&render=true&ultra_premium=true"
    return f"http://api.scraperapi.com/?{params}"

async def main():
    client = httpx.AsyncClient(headers=HEADERS, timeout=180.0)
    
    url = "https://www.central.co.th/en/c/cat/C0001"
    resp = await client.get(build_url(url))
    text = resp.text
    print(f"Status: {resp.status_code}, Length: {len(text)}")
    
    # Check 404 reason
    if resp.status_code == 404:
        # Check what the 404 page looks like
        if "Access denied" in text or "Cloudflare" in text:
            print("Blocked by Cloudflare")
        elif "Not Found" in text[:500]:
            print("Page not found (404)")
        else:
            print("404 but not Cloudflare - checking further...")
    
    # Find initialData and look for hits in a wider window
    init_pos = text.find('"initialData"')
    if init_pos < 0:
        print("No initialData in response")
    else:
        print(f"initialData found at position {init_pos}")
        # Look for hits in the next 20000 chars after initialData
        search_region = text[init_pos:init_pos+50000]
        hits_pos = search_region.find('"hits"')
        print(f"hits found at offset {hits_pos} after initialData")
        if hits_pos >= 0:
            print(f"Context around hits: {search_region[hits_pos:hits_pos+200]}")
    
    # Also look for the data more broadly
    # The hits contain "name_th" which we saw before
    name_th_pos = text.find('"name_th"')
    if name_th_pos >= 0:
        print(f"name_th context: {text[name_th_pos-100:name_th_pos+300]}")
    
    # Look for Algolia-style data  
    algolia_pos = text.find('algolia')
    if algolia_pos >= 0:
        print(f"Algolia context: {text[algolia_pos:algolia_pos+200]}")
    
    await client.aclose()

asyncio.run(main())