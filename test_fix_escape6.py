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
    
    # Better array extraction - track depth properly
    depth = 0  # Start at 0, will increment when we see the opening [
    in_string = False
    escape = False
    end_pos = len(json_text)
    array_start = bracket_pos + 1
    
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
        if c == '{' or c == '[':
            depth += 1
        elif c == '}' or c == ']':
            depth -= 1
            if depth == 0:
                end_pos = i + 1
                break
    
    raw_array = json_text[array_start:end_pos]
    print(f'Raw array length: {len(raw_array)}')
    print(f'Raw array first 100 repr: {repr(raw_array[:100])}')
    print(f'Raw array last 100 repr: {repr(raw_array[-100:])}')
    
    # Unescape the HTML-escaped quotes
    unescaped = raw_array.replace(chr(92) + chr(34), '"')
    print(f'Unescaped first 100: {repr(unescaped[:100])}')
    
    # Parse one object at a time manually
    decoder = json.JSONDecoder()
    idx = 0
    products = []
    while idx < len(unescaped):
        try:
            obj, new_idx = decoder.raw_decode(unescaped, idx)
            products.append(obj)
            idx = new_idx
            # Skip any comma
            while idx < len(unescaped) and unescaped[idx] in ' \t\n\r,':
                idx += 1
        except json.JSONDecodeError as e:
            print(f"Error at idx {idx}: {e}")
            print(f"Context: {repr(unescaped[idx:idx+100])}")
            break
    
    print(f'\nParsed {len(products)} products!')
    for p in products[:3]:
        print(f'  SKU: {p.get("sku")}, name_en: {p.get("name_en","")[:50]}, price: {p.get("final_price")}')

asyncio.run(main())