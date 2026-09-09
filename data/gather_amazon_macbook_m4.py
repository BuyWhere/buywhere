#!/usr/bin/env python3
"""
Gather real MacBook Air M4 laptop listings from Amazon SG for the
cheapest-macbook-air-m4-singapore intent gap (BUY-75975).

Strategy to avoid Amazon rate-limit storms:
 1. Fetch each search results page once.
 2. Mine the result CARDS for (asin, title, price, rating, reviews, image)
    directly from the embedded JSON, WITHOUT per-ASIN detail fetches.
 3. Filter to ACTUAL MacBook Air laptops (exclude cases/covers/accessories).
 4. Write JSONL matching the amazon_sg catalog schema. Print ONE summary line.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

MERCHANT_ID = "amazon_sg"
SOURCE = "amazon_sg"
BASE_URL = "https://www.amazon.sg"
OUT_DIR = "/home/paperclip/buywhere/data/amazon_sg_macbook_m4"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-SG,en;q=0.9",
    "Referer": "https://www.amazon.sg/",
}

# Accessory/irrelevant substrings indicating NOT an actual MacBook laptop
NON_LAPTOP = re.compile(
    r"\b(case|cover|sleeve|screen ?protector|film|keyboard ?cover|skin|"
    r"stand|hub|adapter|charger|cable|dock|bag|sticker|mount|holder|"
    r"bumper|shell|cleaner|lock|webcam ?cover|arm|tray|folio|folios|"
    r"desk|mat|wiper|brush|clove|laptop cover|hard ?shell)\b",
    re.IGNORECASE,
)

KEYWORDS = [
    "macbook air m4",
    "macbook air 13 m4",
    "macbook air 15 m4",
    "apple macbook air m4",
]


def fetch(url, retries=2):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(3)
            else:
                print(f"  WARN fetch fail {url}: {e}", file=sys.stderr)
                return None
    return None


def mine_search_cards(html):
    """Pair each data-asin with its title/price/rating from the search page."""
    results = {}
    for m in re.finditer(r'data-asin="(B0[0-9A-Z]{8})"([^>]*?)>(.*?)(?=data-asin=|\Z)',
                         html, re.S):
        asin = m.group(1)
        body = m.group(3)
        title = _grab_title(body, asin)
        if not title:
            continue
        results[asin] = {
            "asin": asin,
            "title": title,
            "price": _grab_price(body),
            "rating": _grab_rating(body),
            "reviews": _grab_reviews(body),
            "image": _grab_image(body),
        }
    return results


def _grab_title(body, asin):
    # title is on the <img alt="..."> which carries the product name
    m = re.search(r'class="s-image["\']?\s+[^>]*alt="([^"]+)"', body)
    if m:
        return m.group(1).strip()
    m = re.search(r'alt="([^"]{20,250})"', body)
    return m.group(1).strip() if m else ""


def _grab_price(body):
    m = re.search(r'a-price-whole">([0-9,]+)<', body)
    if m:
        return float(m.group(1).replace(",", ""))
    return None


def _grab_rating(body):
    m = re.search(r'class="[^"]*a-icon-alt"[^>]*>([0-9.]+)', body)
    if m:
        return float(m.group(1))
    m = re.search(r'"([0-9.]+) out of 5 stars"', body)
    return float(m.group(1)) if m else 0.0


def _grab_reviews(body):
    m = re.search(r'-?([0-9,]+)\s*ratings', body)
    if m:
        return int(re.sub(r"[^0-9]", "", m.group(1)))
    return 0


def _grab_image(body):
    m = re.search(r'class="s-image"[^>]*src="([^"]+)"', body)
    return m.group(1) if m else ""


def is_actual_macbook(title):
    t = title.lower()
    if "macbook air" not in t:
        return False
    if NON_LAPTOP.search(t):
        return False
    if "macbook air" in t and "macbook pro" in t:
        return False
    return True


def gather():
    os.makedirs(OUT_DIR, exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    outfile = os.path.join(OUT_DIR, f"macbook_air_m4_{ts}.jsonl")

    seen = {}
    candidates = []  # real macbook airs found from search cards

    for kw in KEYWORDS:
        search_url = f"{BASE_URL}/s?k={urllib.parse.quote_plus(kw)}&i=electronics"
        html = fetch(search_url)
        if not html:
            continue
        cards = mine_search_cards(html)
        print(f"  [search] '{kw}': {len(cards)} cards scored", file=sys.stderr)
        for asin, card in cards.items():
            if asin in seen:
                continue
            seen[asin] = True
            if not is_actual_macbook(card["title"]):
                continue
            if card["price"] is None:
                continue
            candidates.append((asin, card))
        time.sleep(2.0)

    products = []
    for asin, card in candidates:
        rec = {
            "sku": asin,
            "gtin": "",
            "mpn": "",
            "merchant_id": MERCHANT_ID,
            "title": card["title"],
            "description": "",
            "price": card["price"],
            "currency": "SGD",
            "url": f"{BASE_URL}/dp/{asin}",
            "image_url": card["image"],
            "category": "Electronics",
            "category_path": ["Electronics", "laptop"],
            "brand": "Apple",
            "is_active": True,
            "in_stock": True,
            "region": "SG",
            "country_code": "SG",
            "metadata": {
                "keyword": "macbook air m4",
                "source": SOURCE,
                "original_price": card["price"],
                "rating": card["rating"],
                "review_count": card["reviews"],
                "is_sponsored": False,
            },
        }
        products.append(rec)
        print(f"  [gather] + {asin}: {card['title'][:60]} @ S${card['price']}", file=sys.stderr)

    written = 0
    with open(outfile, "w", encoding="utf-8") as f:
        for p in products:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")
            written += 1
    print(f"wrote {written} real MacBook Air products to {outfile}")
    return written, outfile


if __name__ == "__main__":
    gather()
