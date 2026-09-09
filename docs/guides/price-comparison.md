---
title: "Build a Price Comparison Tool"
description: "Build a CLI tool that searches for a product across multiple retailers and shows the best prices, in under 50 lines of Python."
public: true
---

# Build a Price Comparison Tool with Python

Build a CLI tool that searches for a product across multiple retailers and shows the best prices, in under 50 lines of Python.

## Prerequisites

- Python 3.8+
- A BuyWhere API key ([get one free](https://buywhere.ai/api-keys)) — or let your agent self-register in one call (no email, no human): `curl -X POST "https://api.buywhere.ai/v1/auth/register?verify=false" -H "Content-Type: application/json" -d '{"agent_name":"my-agent"}'`
- `httpx` (`pip install httpx`)

## The Code

```python
import httpx
import sys
import os

API_KEY = os.environ["BUYWHERE_API_KEY"]
BASE_URL = "https://api.buywhere.ai/v1"
HEADERS = {"Authorization": f"Bearer {API_KEY}"}

def search(query: str, limit: int = 10) -> list:
    resp = httpx.get(
        f"{BASE_URL}/products/search",
        params={"q": query, "sort": "price_asc", "limit": limit},
        headers=HEADERS,
    )
    resp.raise_for_status()
    return resp.json()["results"]

def format_price(product: dict) -> str:
    p = product["price"]
    line = f"  {p['currency']} {p['amount']:>8.2f}  {product['title'][:60]}"
    if product.get("original_price"):
        saving = product["original_price"] - p["amount"]
        line += f"  (save {p['currency']} {saving:.2f}, {product['discount_pct']}% off)"
    return line

def main():
    query = " ".join(sys.argv[1:]) or "wireless headphones"
    print(f"\nSearching for: {query}\n")

    results = search(query)
    if not results:
        print("No products found.")
        return

    print(f"Found {len(results)} results (cheapest first):\n")
    for i, product in enumerate(results, 1):
        print(f"{i:>2}. {format_price(product)}")
        print(f"      {product['merchant']} — {product['url']}")
        print()

if __name__ == "__main__":
    main()
```

## Usage

```bash
export BUYWHERE_API_KEY="bw_live_xxx"
python price_compare.py mechanical keyboard
```

Output:

```
Searching for: mechanical keyboard

Found 10 results (cheapest first):

 1.   SGD    39.90  Redragon K552 Mechanical Gaming Keyboard
      shopee — https://shopee.sg/...

 2.   SGD    59.00  Royal Kludge RK61 60% Mechanical Keyboard
      lazada — https://www.lazada.sg/products/...

 3.   SGD    89.00  Keychron K2 V2 Wireless Mechanical Keyboard  (save SGD 30.00, 25% off)
      amazon.sg — https://www.amazon.sg/dp/...
```

## Extending It

### Add country filtering

```python
def search(query: str, country: str = "SG", limit: int = 10) -> list:
    resp = httpx.get(
        f"{BASE_URL}/products/search",
        params={"q": query, "country_code": country, "sort": "price_asc", "limit": limit},
        headers=HEADERS,
    )
    resp.raise_for_status()
    return resp.json()["results"]
```

### Track price history for the cheapest result

```python
def price_history(product_id: str, days: int = 30) -> dict:
    resp = httpx.get(
        f"{BASE_URL}/products/{product_id}/price-history",
        params={"days": days},
        headers=HEADERS,
    )
    resp.raise_for_status()
    return resp.json()["data"]

# After finding results:
cheapest = results[0]
history = price_history(cheapest["id"])
print(f"\n30-day price range: {history['stats']['min']} – {history['stats']['max']}")
print(f"Current price is {'at' if cheapest['price']['amount'] == history['stats']['min'] else 'above'} the 30-day low")
```

### Compare top 3 results

```python
def compare(product_ids: list) -> list:
    ids = ",".join(product_ids)
    resp = httpx.get(
        f"{BASE_URL}/products/compare",
        params={"ids": ids},
        headers=HEADERS,
    )
    resp.raise_for_status()
    return resp.json()["results"]

# Compare the top 3 cheapest:
top_ids = [r["id"] for r in results[:3]]
comparison = compare(top_ids)
```

## Next Steps

- [API Reference](/docs/api-reference/search) — full search parameter documentation
- [MCP Integration](/docs/guides/mcp-integration) — connect BuyWhere to AI agents
- [Error Reference](/docs/errors) — handle errors gracefully
