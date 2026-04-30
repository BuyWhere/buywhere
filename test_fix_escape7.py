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
    hits_match_start = hits_pattern.start()
    bracket_pos = json_text.find('[', hits_match_start)
    
    # Find the actual array bounds properly
    depth = 0
    in_string = False
    escape = False
    array_start = bracket_pos + 1
    end_pos = len(json_text)
    
    for i in range(bracket_pos + 1, len(json_text)):
        c = json_text[i]
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
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        elif c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0:
                end_pos = i + 1
                break
    
    raw_array = json_text[array_start:end_pos]
    print(f'Raw array length: {len(raw_array)}')
    print(f'First 200: {repr(raw_array[:200])}')
    print(f'Last 200: {repr(raw_array[-200:])}')
    
    # Unescape
    unescaped = raw_array.replace(chr(92) + chr(34), '"')
    
    # Parse incrementally
    decoder = json.JSONDecoder()
    idx = 0
    products = []
    errors = 0
    while idx < len(unescaped):
        # Skip whitespace
        while idx < len(unescaped) and unescaped[idx] in ' \t\n\r':
            idx += 1
        if idx >= len(unescaped):
            break
        if unescaped[idx] == ',':
            idx += 1
            continue
        try:
            obj, new_idx = decoder.raw_decode(unescaped, idx)
            products.append(obj)
            idx = new_idx
        except json.JSONDecodeError as e:
            errors += 1
            if errors <= 5:
                print(f"Error at {idx}: {e}")
                print(f"Context: {repr(unescaped[max(0,idx-20):idx+50])}")
            # Try to recover by skipping forward
            idx += 1
    
    print(f'\nParsed {len(products)} products with {errors} errors')
    for p in products[:5]:
        print(f'  SKU: {p.get("sku")}, name_en: {p.get("name_en","")[:50]}')

asyncio.run(main())