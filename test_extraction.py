import cloudscraper, re, json

def extract_products_from_html(html: str) -> list[dict]:
    products = []
    
    script_match = re.search(r'<script[^>]*>([^<]*initialData[^<]*)</script>', html, re.DOTALL)
    if not script_match:
        print('No script match')
        return products
    
    script_content = script_match.group(1)
    init_pos = script_content.find('initialData')
    if init_pos < 0:
        print('No initialData')
        return products
    
    json_start = script_content.find('{', init_pos)
    json_text = script_content[json_start:json_start + 500000]
    print(f'json_text length: {len(json_text)}')
    
    hits_pattern = re.search(r'\\"hits\\"\s*:\s*\[', json_text)
    if not hits_pattern:
        print('No hits pattern')
        # Debug: try to find hits manually
        idx = json_text.find('hits')
        print(f'Plain hits at: {idx}')
        print(f'Context around hits: {repr(json_text[idx-5:idx+20])}')
        return products
    
    print(f'hits found at: {hits_pattern.start()}')
    hits_match_start = hits_pattern.start()
    bracket_pos = json_text.find('[', hits_match_start)
    
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
    print(f'raw_array length: {len(raw_array)}')
    unescaped = raw_array.replace(chr(92) + chr(34), '"')
    
    decoder = json.JSONDecoder()
    idx = 0
    while idx < len(unescaped):
        while idx < len(unescaped) and unescaped[idx] in ' \t\n\r':
            idx += 1
        if idx >= len(unescaped):
            break
        if unescaped[idx] == ',':
            idx += 1
            continue
        try:
            obj, new_idx = decoder.raw_decode(unescaped, idx)
            if not isinstance(obj, dict):
                idx += 1
                continue
            products.append({
                "sku": obj.get("sku", ""),
                "name_th": obj.get("name_th", ""),
                "name_en": obj.get("name_en", ""),
                "price": obj.get("price", 0),
                "final_price": obj.get("final_price", obj.get("price", 0)),
                "discount_pct": obj.get("discount_percentage", 0),
                "image": obj.get("thumbnail_url", ""),
                "url": obj.get("url_key", ""),
                "brand_name": obj.get("brand_name", ""),
                "rating_count": obj.get("rating_count", 0),
                "rating_summary": obj.get("rating_summary", 0),
            })
            idx = new_idx
        except json.JSONDecodeError:
            idx += 1
            continue
    
    print(f'Extracted {len(products)} products')
    return products

scraper = cloudscraper.create_scraper(browser={'browser': 'chrome', 'platform': 'windows', 'desktop': True}, delay=10)

print('Testing page 1:')
resp1 = scraper.get('https://www.central.co.th/en/beauty', timeout=30)
products1 = extract_products_from_html(resp1.text)
print(f'Page 1: {len(products1)} products\n')

print('Testing page 2:')
resp2 = scraper.get('https://www.central.co.th/en/beauty?page=2', timeout=30)
products2 = extract_products_from_html(resp2.text)
print(f'Page 2: {len(products2)} products')