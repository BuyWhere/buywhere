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
    
    # Find the hits\":[ pattern
    hits_pattern = re.search(r'\\"hits\\"\s*:\s*\[', json_text)
    hits_match_start = hits_pattern.start()
    
    print(f'hits match found at: {hits_match_start}')
    print(f'hits match text: {repr(json_text[hits_match_start:hits_match_start+30])}')
    
    # The [ should be right after hits":
    bracket_pos = json_text.find('[', hits_match_start)
    print(f'Bracket found at: {bracket_pos}')
    print(f'Bracket context: {repr(json_text[bracket_pos:bracket_pos+20])}')
    
    # Extract array using depth counting from the bracket
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
    print(f'\nRaw array length: {len(raw_array)}')
    print(f'Raw array first 100 repr: {repr(raw_array[:100])}')
    
    # The raw_array has HTML-escaped quotes. Need to unescape properly
    # In HTML/JS context, the text contains \\" which should be "
    # But the actual bytes are backslash (92) followed by quote (34)
    # We need to replace the two-char sequence \\" with "
    
    # Let's check the actual bytes
    print(f'\nFirst 20 bytes of raw_array: {[ord(c) for c in raw_array[:20]]}')
    
    # Try replacing the sequence
    unescaped = raw_array.replace(chr(92) + chr(34), '"')
    print(f'Unescaped first 100: {repr(unescaped[:100])}')
    
    # Try parsing
    try:
        hits = json.loads('[' + unescaped + ']')
        print(f'\nParsed {len(hits)} products!')
        for h in hits[:3]:
            print(f'  SKU: {h.get("sku")}, name_en: {h.get("name_en","")[:50]}')
    except Exception as e:
        print(f'\nParse error: {e}')

asyncio.run(main())