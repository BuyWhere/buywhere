---
title: "Build a Shopping Copilot with OpenAI Agents SDK and BuyWhere"
description: "Learn how to build AI shopping agents that reliably query product catalogs using the OpenAI Agents SDK and BuyWhere's structured product API — no web scraping required."
excerpt: "Step-by-step guide to building AI shopping copilots with OpenAI Agents SDK and BuyWhere's structured product catalog. Includes working code examples, SDK setup, and conversion-focused CTA placement."
syndication_hook: "How to build a production-ready shopping copilot that queries real product data — not scraped HTML. OpenAI Agents SDK + BuyWhere API tutorial."
date: "2026-04-21"
tags: ["OpenAI Agents SDK", "AI Shopping Agents", "Product Catalog API", "Developer Tutorial"]
cta_target: "/developers#signup"
---

# Build a Shopping Copilot with OpenAI Agents SDK and BuyWhere

**Stop wrestling with scraped product data.** This tutorial shows you how to build AI shopping agents that reliably query structured product catalogs using the OpenAI Agents SDK and BuyWhere — with clean code you can ship today.

**[Get your free API key →](/developers#signup)** No credit card required.

---

## Why BuyWhere for AI Shopping Agents?

If you're building an AI shopping agent, you face a fundamental choice: scrape e-commerce websites or use a structured product catalog API.

Scraping introduces three hard problems:
- **Reliability**: One site redesign breaks your entire pipeline
- **Legal risk**: Terms of service violations can threaten your business
- **Data quality**: Scraped HTML varies wildly — missing prices, malformed data, encoding errors

BuyWhere solves these by giving you a **normalized, structured product catalog API** with:
- Consistent JSON responses across 50+ retailers
- Real-time price and availability data
- Clean attribution and affiliate links
- Full API compliance — no legal gray areas

**Bottom line**: Your agent spends less time handling edge cases and more time helping users find products.

---

## Architecture Overview

A shopping copilot built with OpenAI Agents SDK follows this pattern:

```
User Query → OpenAI Agent → BuyWhere API → Structured Product Data → Natural Language Response
```

The agent interacts with clean, normalized product data rather than parsing HTML, leading to more reliable tool calls and better user experiences.

## Step-by-Step Setup

### 1. Prerequisites
- OpenAI API key
- BuyWhere API key (**[get yours free at developers.buywhere.ai →](/developers#signup)**)
- Python 3.8+
- OpenAI Agents SDK installed

### 2. Install Dependencies
```bash
pip install openai-agents buywhere-sdk
```

### 3. Configure Your Environment
```python
import os
from buywhere_sdk import BuyWhere

os.environ["OPENAI_API_KEY"] = "your-openai-key"
os.environ["BUYWHERE_API_KEY"] = "your-buywhere-key"

buywhere_client = BuyWhere(api_key=os.environ["BUYWHERE_API_KEY"])
```

### 4. Create Product Search Tool
```python
from agents import function_tool

@function_tool
def search_products(query: str, max_price: float = None, min_rating: float = None):
    """Search for products using BuyWhere's structured catalog."""
    params = {}
    if max_price:
        params['max_price'] = max_price
    if min_rating:
        params['min_rating'] = min_rating
    
    results = buywhere_client.search(query=query, **params)
    return results
```

### 5. Build Your Shopping Copilot Agent
```python
from agents import Agent

shopping_copilot = Agent(
    name="ShoppingCopilot",
    instructions="""You are a helpful shopping assistant. Use search_products to find items matching user preferences. Always provide concise, helpful responses with key product details: name, brand, price, availability, and where to buy. Format prices clearly and note if items are in stock.""",
    tools=[search_products],
    model="gpt-4o"
)
```

**[See full SDK documentation →](/docs/sdk/python)** for all available search parameters and filtering options.

## Example Usage

### Basic Product Search
```python
result = await shopping_copilot.run(
    "Find me wireless headphones under $150 with good battery life"
)
print(result.final_output)
```

### Singapore-Specific Product Discovery
```python
result = await shopping_copilot.run(
    "Find me Samsung Galaxy S24 phones available in Singapore under SGD 1200"
)
print(result.final_output)
```

### Comparison Shopping with Local Availability
```python
result = await shopping_copilot.run(
    "Compare prices for Nike Air Max shoes in Singapore stores and show me which ones are available for same-day delivery"
)
print(result.final_output)
```

## Why BuyWhere Beats Scraping

| Factor | Web Scraping | BuyWhere API |
|--------|-------------|--------------|
| **Reliability** | Breaks on site redesigns | Stable — site changes don't affect you |
| **Latency** | 500ms–2s per page | <50ms structured responses |
| **Legal risk** | Terms of service violations | Full API compliance |
| **Data quality** | Inconsistent, often missing fields | Normalized, always complete |
| **Maintenance** | Constant selector updates | Zero upkeep |

**Your agents get reliable data. You get your weekends back.**

**[Start building →](/developers#signup)** — free tier includes 10,000 API calls/month.

## Tool Call Examples

The OpenAI Agents SDK handles the tool calling complexity. Here's what happens under the hood:

### Basic Product Search
```json
{
  "tool": "search_products",
  "arguments": {
    "query": "wireless headphones",
    "max_price": 150,
    "min_rating": 4.0
  }
}
```

### Singapore-Specific Search
```json
{
  "tool": "search_products",
  "arguments": {
    "query": "Samsung Galaxy S24",
    "source": "shopee_sg",
    "max_price": 1200
  }
}
```

### Local Availability Check
```json
{
  "tool": "search_products",
  "arguments": {
    "query": "Nike Air Max",
    "source": "shopee_sg"
  }
}
```

BuyWhere returns structured data like:
```json
{
  "products": [
    {
      "id": "prod_123",
      "name": "Sony WH-1000XM5",
      "brand": "Sony",
      "price": 149.99,
      "rating": 4.5,
      "availability": "in_stock",
      "features": ["Noise Cancelling", "30hr Battery", "Multipoint Connection"]
    }
  ]
}
```

## Getting Started in 5 Minutes

1. **[Sign up for free API access →](/developers#signup)** — no credit card required
2. Copy your API key from the dashboard
3. Run `pip install buywhere-sdk`
4. Use the code examples above to build your first shopping copilot

## Ready to Ship?

Join developers already building AI shopping agents with BuyWhere:

- **50+ retailers** covered across Singapore, Malaysia, Thailand, Indonesia, and the US
- **Real-time price and availability** data
- **Structured product attributes** — specs, reviews, brand, category
- **Affiliate integration** for monetization

**[Get your API key →](/developers#signup)** | **[View SDK documentation →](/docs/sdk/python)** | **[See code examples →](/docs/examples)**

*Illustration: Architecture diagram showing OpenAI Agent → BuyWhere API → Structured Product Data flow, with comparison to brittle scraping approach.*