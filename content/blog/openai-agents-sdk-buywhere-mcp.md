---
slug: "openai-agents-sdk-buywhere-mcp-tutorial"
title: "Build an AI Shopping Agent with OpenAI Agents SDK + BuyWhere MCP"
description: "Step-by-step tutorial showing how to build a powerful AI shopping agent using OpenAI's Agents SDK and BuyWhere's MCP server for real-time product search and price comparison."
author: "BuyWhere Team"
publishedAt: "2026-06-19"
lastUpdatedAt: "2026-06-19"
tags: ["openai", "agents-sdk", "mcp", "tutorial", "shopping-agent", "python"]
jsonLd: >
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        "headline": "Build an AI Shopping Agent with OpenAI Agents SDK + BuyWhere MCP",
        "description": "Step-by-step tutorial for building an AI shopping agent using OpenAI's Agents SDK and BuyWhere's MCP server for real-time product search and price comparison.",
        "proficiencyLevel": "Beginner",
        "dependencies": "Python 3.10+, OpenAI API key, BuyWhere API key",
        "datePublished": "2026-06-19"
      }
    ]
  }
category: Blog
schema_type: TechArticle
published: true
---

In this tutorial, you will build an AI shopping agent that searches products, compares prices across retailers, and finds deals using natural language. You will use:

- **OpenAI Agents SDK** (Python) -- the official framework for building agentic AI apps
- **BuyWhere MCP API** -- a Model Context Protocol-compatible API providing real-time product search and price comparison across 50M+ products

## Prerequisites

- Python 3.10+
- An OpenAI API key
- A BuyWhere API key (free at https://buywhere.ai)

## Step 1: Set up the project


Create a new project directory and install the required packages:

```bash
mkdir shopping-agent
cd shopping-agent
python -m venv venv
source venv/bin/activate
pip install openai-agents httpx python-dotenv
```

## Step 2: Configure environment

Create a `.env` file:

```
OPENAI_API_KEY=sk-...
BUYWHERE_API_KEY=bw_...
```


## Step 3: Create the shopping agent

Create `shopping_agent.py`:

```python
import os
import json
import httpx
from dotenv import load_dotenv
from agents import Agent, Runner, function_tool

load_dotenv()

BUYWHERE_API_URL = "https://api.buywhere.ai/mcp/v1"
BUYWHERE_API_KEY = os.getenv("BUYWHERE_API_KEY")

@function_tool
async def search_products(query: str, limit: int = 10) -> str:
    """Search for products across major online retailers.

    Args:
        query: Natural language product search query
        limit: Maximum number of results (default 10)
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BUYWHERE_API_URL}/search",
            headers={"Authorization": f"Bearer {BUYWHERE_API_KEY}"},
            json={"q": query, "limit": limit}
        )
        return json.dumps(resp.json(), indent=2)

@function_tool
async def compare_prices(query: str) -> str:
    """Compare prices for a product across multiple retailers.

    Args:
        query: Product search query to compare across retailers
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BUYWHERE_API_URL}/compare",
            headers={"Authorization": f"Bearer {BUYWHERE_API_KEY}"},
            json={"q": query}
        )
        return json.dumps(resp.json(), indent=2)

@function_tool
async def get_deals(category: str = "", min_discount: int = 0) -> str:
    """Get current deals and discounts.

    Args:
        category: Optional category filter
        min_discount: Minimum discount percentage (default 0)
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BUYWHERE_API_URL}/deals",
            headers={"Authorization": f"Bearer {BUYWHERE_API_KEY}"},
            json={"category": category, "min_discount": min_discount}
        )
        return json.dumps(resp.json(), indent=2)


async def main():
    agent = Agent(
        name="Shopping Agent",
        instructions="You are a helpful shopping assistant. Use the BuyWhere tools to search for products, compare prices, and find deals. Always show prices in SGD and include the retailer name.",
        tools=[search_products, compare_prices, get_deals],
    )

    result = await Runner.run(agent, "Find the best price for Sony WH-1000XM6 headphones in Singapore")
    print(result.final_output)

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

## Step 4: Run it

```bash
python shopping_agent.py
```


## How It Works

The OpenAI Agents SDK manages the agent lifecycle -- reasoning, tool selection, and response generation. Each `@function_tool` decorated function becomes a tool the agent can call. BuyWhere provides the product data layer via its MCP-compatible HTTP API:

1. User asks a natural language question
2. The agent decides which BuyWhere tool to call
3. BuyWhere searches across retailers and returns structured product data
4. The agent synthesizes the results into a human-readable answer

## Available BuyWhere Tools

| Tool | Description |
|------|-------------|
| `search_products` | Full-text search across 50M+ products |
| `compare_prices` | Compare prices across retailers |
| `get_deals` | Current deals and discounts |
| `get_product` | Detailed product information by ID |
| `list_categories` | Browse available product categories |
| `find_best_price` | Find the lowest price across retailers |

## Going Further

Add price drop alerts, multi-product comparison, and deal discovery by extending the agent with additional BuyWhere tools.

## Resources

- [OpenAI Agents SDK docs](https://openai.github.io/openai-agents-python/)
- [BuyWhere API docs](https://buywhere.ai/docs)
- [Get a BuyWhere API key](https://buywhere.ai/api-keys)


---

*BuyWhere -- Compare prices across 20+ retailers. Save money. Shop smarter.*

