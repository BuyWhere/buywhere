---
title: "Build a Price Comparison Shopping Agent with BuyWhere MCP"
slug: "build-shopping-agent-buywhere-mcp"
publishedAt: "2026-06-18"
description: "Step-by-step tutorial for building an AI shopping agent using BuyWhere's MCP server. Search 11M+ products, compare prices across Amazon Walmart Shopee, and track deals with 50 lines of Python."
category: Blog
tags:
  - "MCP"
  - "shopping agent"
  - "price comparison"
  - "AI agent"
  - "LangChain"
  - "product search API"
  - "price tracking"
  - "developer tutorial"
---

# Build a Price Comparison Shopping Agent with BuyWhere MCP

AI shopping agents are one of the most practical applications of the Model Context Protocol (MCP). With BuyWhere's MCP server, you can build an agent that searches products, compares prices, and tracks deals across 11M+ products from Amazon, Walmart, Shopee, Lazada, and thousands of other retailers — in under 50 lines of code.

In this tutorial, you'll build a price comparison agent using Python and the `langchain-mcp-adapter` package.

## Prerequisites

- Python 3.10+
- A BuyWhere API key (free — get one at buywhere.ai/api-keys)
- `pip install langchain-mcp-adapter httpx`

## Step 1: Get Your API Key

Sign up at [buywhere.ai](https://buywhere.ai) and navigate to **API Keys**. Create a new key and save it — you'll need it to authenticate your agent.

## Step 2: Connect to BuyWhere MCP

BuyWhere exposes four MCP tools:

| Tool | Description |
|------|-------------|
| `search_products` | Full-text search across 11M+ products |
| `compare_prices` | Side-by-side price comparison |
| `get_price_history` | 90-day price trend data |
| `get_price_alerts` | Set threshold-based price drop alerts |

Here's how to connect:

```python
import json
import httpx

BUYWHERE_API_URL = "https://api.buywhere.ai/mcp/v1"
API_KEY = "your-api-key-here"

async def search_products(query: str, limit: int = 5):
    """Search products using BuyWhere MCP."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{BUYWHERE_API_URL}/search",
            headers={"Authorization": f"Bearer {API_KEY}"},
            json={"query": query, "limit": limit}
        )
        return response.json()
```

## Step 3: Build the Agent

Now let's create a ReAct agent that can search and compare prices:

```python
from langchain_mcp_adapter import MCPClient
from langchain.agents import create_react_agent, AgentExecutor
from langchain_openai import ChatOpenAI

# Initialize MCP client pointing to BuyWhere
mcp = MCPClient(
    server_url="https://api.buywhere.ai/mcp/v1",
    headers={"Authorization": f"Bearer {API_KEY}"}
)

# Load tools from MCP
tools = mcp.load_tools()

# Create the agent
llm = ChatOpenAI(model="gpt-4o")
agent = create_react_agent(llm, tools, prompt="You are a shopping assistant.")
executor = AgentExecutor(agent=agent, tools=tools)

# Run a query
result = executor.invoke({
    "input": "Find me the cheapest RTX 4070 GPU across all retailers and compare prices"
})
print(result["output"])
```

## Step 4: Add Price Alerts

Want to know when a product drops to your target price? Use the alert tool:

```python
result = executor.invoke({
    "input": "Set a price alert for Sony WH-1000XM5 headphones — notify me if it drops below $250"
})
```

## What's Next?

- Check the full [BuyWhere API docs](https://buywhere.ai/docs)
- Explore the [MCP server on GitHub](https://github.com/buywhere/buywhere-mcp)
- Browse [best deals by category](https://buywhere.ai/categories)
