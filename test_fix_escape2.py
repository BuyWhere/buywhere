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
    
    # Find where the array actually starts (after the [ after hits":)
    array_start_offset = json_text.find('[', hits_start) + 1
    array_start = hits_start + array_start_offset
    
    # Now extract until we find the matching ]
    depth = 1
    in_string = False
    escape = False
    end = len(json_text)
    
    for i in range(array_start_offset, len(json_text)):
        c = json_text[hits_start + i]
        if escape:
            escape = False
            continue
        if c == '\\':
            escape = True
            continue
        if c == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0:
                end = hits_start + i + 1
                break
    
    array_only = json_text[array_start:end]
    print(f'Array only length: {len(array_only)}')
    print(f'Array only first 100: {repr(array_only[:100])}')
    
    # Fix the escaped quotes
    fixed_array = array_only.replace('\\"', '"')
    print(f'\nFixed first 100: {repr(fixed_array[:100])}')
    
    try:
        hits = json.loads(fixed_array)
        print(f'\nParsed {len(hits)} products!')
        for h in hits[:3]:
            print(f'  SKU: {h.get("sku")}, name_en: {h.get("name_en","")[:50]}')
    except Exception as e:
        print(f'\nParse error: {e}')

asyncio.run(main())