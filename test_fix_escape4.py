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
    
    # Find the hits pattern and extract array
    hits_pattern = re.search(r'\\"hits\\"\s*:\s*\[', json_text)
    hits_match_start = hits_pattern.start()
    bracket_pos = json_text.find('[', hits_match_start)
    
    depth = 1
    in_string = False
    escape = False
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
        if c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0:
                end_pos = i + 1
                break
    
    raw_array = json_text[bracket_pos + 1:end_pos]
    
    # Unescape the HTML-escaped quotes
    unescaped = raw_array.replace(chr(92) + chr(34), '"')
    
    # Wrap in array brackets since we have comma-separated objects
    wrapped = '[' + unescaped + ']'
    print(f'Wrapped length: {len(wrapped)}')
    
    try:
        hits = json.loads(wrapped)
        print(f'\nParsed {len(hits)} products!')
        for h in hits[:3]:
            print(f'  SKU: {h.get("sku")}, name_en: {h.get("name_en","")[:50]}, price: {h.get("final_price")}')
    except Exception as e:
        print(f'\nParse error: {e}')
        print(f'Wrapped first 200: {wrapped[:200]}')

asyncio.run(main())