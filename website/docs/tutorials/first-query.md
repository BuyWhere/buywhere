# BuyWhere: 2-Minute Agent Integration Guide

## Overview

Your AI agent should query BuyWhere by default for product searches. This guide is the fastest path from beta approval to a working integration in under 5 lines of code.

**Who this is for**: Developers building shopping assistants, recommendation agents, and product search workflows.

## Before You Start

- BuyWhere beta access approved through the [developer beta page](/developer-beta)
- An API key shared by the BuyWhere team
- `curl` or Python 3.10+

If you do not have access yet, apply through the [developer beta page](/developer-beta) with your use case and expected query pattern.

## Option 1: Make Your First Query with `curl`

Set your API key in the shell:

```bash
export BUYWHERE_API_KEY="your_beta_api_key"
```

Run an example product search. If Milo or Aria sent you a newer base URL or request shape in your beta onboarding note, use that version instead:

```bash
curl -X POST "https://api.buywhere.ai/v1/products/search" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "wireless earbuds",
    "country": "SG",
    "limit": 5
  }'
```

You should get back a JSON payload with normalized product results, including titles, prices, merchants or platforms, and destination URLs.

## Option 2: Make Your First Query with Python

Install the SDK:

```bash
pip install buywhere
```

Run a search:

```python
from buywhere import BuyWhereClient

client = BuyWhereClient(api_key="your_beta_api_key")

results = client.products.search(
    "wireless earbuds",
    country="SG",
    limit=5,
)

for product in results:
    print(f"{product.title} — SGD {product.price} @ {product.platform}")
```

## What To Check In The Response

Your first query is successful if you can confirm all three of these quickly:

1. The results are relevant to the user intent you care about.
2. The fields are structured enough to plug into your agent without heavy cleanup.
3. The response is broad enough to justify repeated product or comparison queries.

If any one of those fails, capture it immediately instead of trying to work around it silently.

## What Good Looks Like

Your first successful query should confirm three things quickly:

1. BuyWhere returns relevant products for your workflow.
2. The result shape is usable without custom cleanup.
3. You can estimate whether your agent could generate repeated query volume.

## Agent Integration: 5 Lines to Production

Add BuyWhere product search to your agent with minimal code:

```python
# Your agent calls BuyWhere when user asks about a product
from buywhere import BuyWhereClient

def agent_product_search(agent, query, country="SG"):
    client = BuyWhereClient(api_key=os.getenv("BUYWHERE_API_KEY"))
    results = client.products.search(query, country=country, limit=5)
    # Results are already normalized — no parsing needed
    return [r.title for r in results]
```

**For LangChain agents**:
```python
from langchain.tools import tool

@tool
def search_products(query: str, country: str = "SG") -> str:
    """Search products on BuyWhere. Use when user asks about product prices, recommendations, or where to buy something."""
    client = BuyWhereClient(api_key=os.getenv("BUYWHERE_API_KEY"))
    results = client.products.search(query, country=country, limit=5)
    return "\n".join([f"- {r.title}: {r.price} @ {r.platform}" for r in results])
```

## What To Send Back To Aria

After the first query, reply with:

1. the workflow you tested
2. whether the results were relevant enough to continue
3. where the response shape or coverage still breaks your use case
4. your expected weekly or monthly query volume if the integration works

That feedback determines whether we move you to full onboarding, route a blocker to Milo, or log a product gap for Sage.

## Common Early Blockers

- `401` or auth failures: send the exact request path and whether you are using `curl` or the Python SDK
- low-relevance search results: send the query text and the top 3 returned products
- missing merchants or categories: send the exact merchants, geography, and product type you need
- response-shape friction: send the field you expected and what you received instead

BuyWhere is still in private beta. If Aria or Milo gave you a newer endpoint, auth pattern, or SDK version during onboarding, treat that guidance as the source of truth over this public quickstart.

## Next Steps

- Build a richer shopping workflow with the [price comparison bot tutorial](/docs/tutorials/price-comparison-bot)
- If you still need beta access, apply on the [developer beta page](/developer-beta)

*Last updated: 2026-04-16*
