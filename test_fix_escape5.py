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
    unescaped = raw_array.replace(chr(92) + chr(34), '"')
    
    # Find a valid JSON substring
    wrapped = '[' + unescaped + ']'
    
    # Try to find where the error is
    for i in range(0, len(wrapped), 10000):
        chunk = wrapped[i:i+100]
        print(f"Position {i}: {repr(chunk)[:80]}")
    
    # Try incremental parsing
    try:
        parser = json.JSONDecoder()
        idx = 0
        while idx < len(wrapped):
            obj, idx = parser.raw_decode(wrapped, idx)
            print(f"Parsed object at idx {idx}")
    except json.JSONDecodeError as e:
        print(f"Error at position {e.pos}")
        print(f"Context around error: {repr(wrapped[max(0,e.pos-50):e.pos+50])}")

asyncio.run(main())