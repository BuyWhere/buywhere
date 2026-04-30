# Building a Price Comparison Bot with BuyWhere

## Introduction

Build a bot that takes a product query, searches across multiple platforms, compares prices, and recommends the best deal. In this tutorial, you'll wire up the BuyWhere Python SDK to fetch live pricing data and surface the cheapest option in under 50 lines of code.

---

## Prerequisites

- Python 3.10 or higher
- A BuyWhere API key from the [developer beta program](/developer-beta)
- `pip install buywhere`

---

## Step 1: Search Across Platforms

Use `client.products.search()` to pull product results from multiple platforms in one call.

```python
from buywhere import BuyWhereClient

client = BuyWhereClient(api_key="your_api_key_here")

results = client.products.search("Sony WH-1000XM5 noise cancelling headphones", limit=10)

for product in results:
    print(f"{product.title} — SGD {product.price} @ {product.platform}")
    print(f"   Affiliate: {product.affiliate_url}")
```

**Response fields:**
- `title` — Product name
- `price` — Price in SGD
- `platform` — e.g., "Shopee", "Lazada", "Amazon.sg"
- `affiliate_url` — Trackable link for commissions

---

## Step 2: Filter and Compare

Pull a structured comparison across specific product IDs to get a ranked view.

```python
# IDs collected from search results
product_ids = [results[0].id, results[1].id, results[2].id]

comparison = client.products.compare(product_ids)

print(f"Cheapest: {comparison.cheapest.title} at SGD {comparison.cheapest.price}")
print(f"Price range: SGD {comparison.price_range.min} – {comparison.price_range.max}")
print(f"Savings vs average: SGD {comparison.cheapest.discount_vs_average:.2f}")
```

The `compare()` method returns:
- `comparison.cheapest` — Product object with the lowest price
- `comparison.price_range` — Min and max prices across platforms
- `comparison.discount_vs_average` — How much you're saving vs the average

---

## Step 3: Check for Deals

Use `client.products.deals()` to surface products with active discounts above a threshold.

```python
deals = client.products.deals(category="electronics", min_discount_pct=15)

for deal in deals:
    print(f"{deal.title}")
    print(f"   Was: SGD {deal.original_price} → Now: SGD {deal.price}")
    print(f"   Discount: {deal.discount_pct}% | Deal Score: {deal.deal_score}")
```

The `deal_score` ranks deals by value — a combination of discount percentage and product popularity. Higher scores = better deals.

---

## Step 4: Set a Price Alert

When you find a product you like but the price isn't right, set an alert.

```python
alert = client.alerts.create(
    product_id=results[0].id,
    threshold=89.00,  # Alert me when price drops below SGD 89
    webhook_url="https://your-app.com/webhooks/buywhere"
)

print(f"Alert created: {alert.id}")
print(f"Tracking {alert.product_title} below SGD {alert.threshold}")
```

When the price drops below your threshold, BuyWhere POSTs to your webhook with the product details and current price.

---

## Full Script

```python
from buywhere import BuyWhereClient

client = BuyWhereClient(api_key="your_api_key_here")

# 1. Search for a product
print("Searching for Sony WH-1000XM5...")
results = client.products.search("Sony WH-1000XM5 noise cancelling headphones", limit=10)

# 2. Check for active deals first
deals = client.products.deals(category="electronics", min_discount_pct=15)
if deals:
    print("\nActive deals found:")
    for deal in deals[:3]:
        print(f"  {deal.title} — {deal.discount_pct}% off at SGD {deal.price}")

# 3. Compare top 3 results
top_3_ids = [r.id for r in results[:3]]
comparison = client.products.compare(top_3_ids)

print(f"\nPrice comparison:")
print(f"  Cheapest: {comparison.cheapest.title} — SGD {comparison.cheapest.price}")
print(f"  Range: SGD {comparison.price_range.min} – {comparison.price_range.max}")

# 4. Set alert if price isn't ideal yet
if comparison.cheapest.price > 350:
    alert = client.alerts.create(
        product_id=comparison.cheapest.id,
        threshold=350.00,
        webhook_url="https://your-app.com/webhooks/buywhere"
    )
    print(f"\nPrice alert set below SGD 350 (Alert ID: {alert.id})")
else:
    print(f"\nGreat price! Buy here: {comparison.cheapest.affiliate_url}")
```

---

## Next Steps

- **First API call** — Start with the [5-minute quickstart](/docs/tutorials/first-query).
- **Developer beta access** — Apply and share your use case on the [developer beta page](/developer-beta).
- **Need MCP or deeper API guidance?** Email [hello@buywhere.ai](mailto:hello@buywhere.ai) with your workflow and we will route the right setup help.

---

*Last updated: 2026-04-03*
