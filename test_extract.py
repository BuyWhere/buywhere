import cloudscraper, re, json

scraper = cloudscraper.create_scraper(browser={'browser': 'chrome', 'platform': 'windows', 'desktop': True}, delay=10)
resp = scraper.get('https://www.central.co.th/en/beauty', timeout=30)

script_match = re.search(r'<script[^>]*>([^<]*initialData[^<]*)</script>', resp.text, re.DOTALL)
script_content = script_match.group(1)

init_pos = script_content.find('initialData')
json_start = script_content.find('{', init_pos)
json_text = script_content[json_start:json_start + 500000]

print(f'json_text length: {len(json_text)}')
print(f'First 100 chars: {repr(json_text[:100])}')

pattern = re.compile(r'\\"hits\\"\s*:\s*\[')
m = pattern.search(json_text)
print(f'Pattern match: {m}')
if m:
    print(f'Found at: {m.start()}, match: {repr(m.group())}')