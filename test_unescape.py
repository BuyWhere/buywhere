import asyncio
import cloudscraper
import re
import json

async def main():
    url = "https://www.central.co.th/en/beauty"
    
    # Test direct cloudscraper
    scraper = cloudscraper.create_scraper(browser={"browser": "chrome", "platform": "windows", "desktop": True}, delay=10)
    resp = scraper.get(url, timeout=60.0)
    
    script_match = re.search(r'<script[^>]*>([^<]*initialData[^<]*)</script>', resp.text, re.DOTALL)
    script_content = script_match.group(1)
    
    init_pos = script_content.find('initialData')
    json_start = script_content.find('{', init_pos)
    json_text = script_content[json_start:json_start + 500000]
    
    hits_pattern = re.search(r'\\"hits\\"\s*:\s*\[', json_text)
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
    print(f'First 100 chars repr: {repr(hits_json[:100])}')
    
    # The issue: the array has escaped quotes so json.loads fails
    # We need to unescape the JSON first
    unescaped = hits_json.encode('utf-8').decode('unicode_escape')
    print(f'\nUnescaped first 100 chars repr: {repr(unescaped[:100])}')
    
    # Try parsing
    try:
        hits = json.loads(unescaped)
        print(f'Unescaped parse: {len(hits)} products')
    except Exception as e:
        print(f'Unescaped parse error: {e}')

asyncio.run(main())