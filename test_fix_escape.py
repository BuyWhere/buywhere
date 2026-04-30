import asyncio
import cloudscraper
import re
import json

async def main():
    url = "https://www.central.co.th/en/beauty"
    
    scraper = cloudscraper.create_scraper(browser={"browser": "chrome", "platform": "windows", "desktop": True}, delay=10)
    resp = scraper.get(url, timeout=60.0)
    
    script_match = re.search(r'<script[^>]*>([^<]*initialData[^<]*)</script>', resp.text, re.DOTALL)
    script_content = script_match.group(1)
    
    init_pos = script_content.find('initialData')
    json_start = script_content.find('{', init_pos)
    json_text = script_content[json_start:json_start + 500000]
    
    hits_pattern = re.search(r'\\"hits\\"\s*:\s*\[', json_text)
    hits_start = hits_pattern.start()
    
    # Find the start of the array (after hits":[ )
    array_start = json_text.find('[', hits_start) + 1
    
    # Now manually extract the array by counting depth
    depth = 1  # We're already inside the array
    in_string = False
    escape = False
    end = hits_start
    array_text = json_text[hits_start:]
    
    result = []
    i = 0
    while i < len(array_text):
        c = array_text[i]
        if escape:
            escape = False
            i += 1
            continue
        if c == '\\':
            escape = True
            i += 1
            continue
        if c == '"':
            in_string = not in_string
            i += 1
            continue
        if in_string:
            i += 1
            continue
        if c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0:
                end = hits_start + i + 1
                break
        i += 1
    
    # Now we have just the array portion, still with escaped quotes
    array_only = array_text[:end - hits_start]
    print(f'Array only length: {len(array_only)}')
    print(f'Array only first 100: {repr(array_only[:100])}')
    
    # The array has JSON objects with escaped quotes like {\"name_th\":\"value\"}
    # We need to fix the escaping: \" -> "
    # But we must be careful not to unescape actual escaped characters like \n
    
    # Simple approach: replace \" with " 
    fixed_array = array_only.replace('\\"', '"')
    print(f'\nFixed array first 100: {repr(fixed_array[:100])}')
    
    try:
        hits = json.loads(fixed_array)
        print(f'\nParsed {len(hits)} products!')
        for h in hits[:3]:
            print(f'  SKU: {h.get("sku")}, name_en: {h.get("name_en","")[:50]}')
    except Exception as e:
        print(f'\nParse error: {e}')

asyncio.run(main())