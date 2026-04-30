import cloudscraper, re

scraper = cloudscraper.create_scraper(browser={'browser': 'chrome', 'platform': 'windows', 'desktop': True}, delay=10)
resp = scraper.get('https://www.central.co.th/en/beauty?page=2', timeout=30)

script_match = re.search(r'<script[^>]*>([^<]*initialData[^<]*)</script>', resp.text, re.DOTALL)
script_content = script_match.group(1)
init_pos = script_content.find('initialData')
json_start = script_content.find('{', init_pos)
json_text = script_content[json_start:json_start + 500000]

print(f'json_text length: {len(json_text)}')
print(f'First 20 chars: {repr(json_text[:20])}')
print(f'First 20 bytes: {[ord(c) for c in json_text[:20]]}')

# The actual bytes in json_text at position 0-20 are:
# [123, 92, 34, 104, 105, 116, 115, 92, 34, 58, 91, 123, 92, 34, 110, 97, 109, 101, 95, 116]
# That corresponds to: { \ " h i t s \ " : [ { \ " n a m e _ t h ...

# The pattern bytes we need to find are:
pattern_bytes = bytes([123, 92, 34, 104, 105, 116, 115, 92, 34, 58, 91])
pattern_str = pattern_bytes.decode('utf-8')
print(f'\nPattern bytes: {list(pattern_bytes)}')
print(f'Pattern str: {repr(pattern_str)}')

idx = json_text.find(pattern_str)
print(f'Pattern found at index: {idx}')

# Check if the pattern is correct
print(f'\nActual first 11 bytes: {[ord(c) for c in json_text[:11]]}')
print(f'Expected first 11 bytes: {list(pattern_bytes)}')

# They should match if the string starts with those bytes
if json_text[:11] == pattern_str:
    print('MATCH! The text starts with the pattern')
else:
    print('NO MATCH - checking character by character:')
    for i in range(min(11, len(json_text))):
        actual = ord(json_text[i])
        expected = pattern_bytes[i]
        match = 'OK' if actual == expected else 'DIFF'
        print(f'  Position {i}: actual={actual}, expected={expected}, {match}')