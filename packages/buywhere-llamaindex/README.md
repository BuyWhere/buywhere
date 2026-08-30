# buywhere-llamaindex

[LlamaIndex](https://www.llamaindex.ai/) `FunctionTool` wrappers for the [BuyWhere](https://buywhere.ai) product catalog API — search, compare, and track prices across 40+ retailers in Southeast Asia and the US.

## Installation

```bash
pip install buywhere-llamaindex
```

## Quick Start

```python
import os
from buywhere_llamaindex import create_buywhere_tools
from llama_index.core.agent import ReActAgent
from llama_index.llms.openai import OpenAI

os.environ["BUYWHERE_API_KEY"] = "bw_live_..."

tools = create_buywhere_tools()
agent = ReActAgent.from_tools(tools, llm=OpenAI(model="gpt-4o"), verbose=True)

response = agent.chat("Find me the cheapest wireless headphones in Singapore under SGD 100")
print(response)
```

## Available Tools

| Tool | Description |
|------|-------------|
| `search_products` | Full-text product search across all retailers |
| `get_product` | Fetch a single product by ID |
| `compare_prices` | Compare prices for a product across retailers |
| `find_deals` | Discover products with the biggest discounts |
| `browse_categories` | List all available product categories |
| `get_category_products` | Get products within a specific category |
| `get_deals` | Get the current deals feed |

## Configuration

Set the `BUYWHERE_API_KEY` environment variable, or pass it directly:

```python
tools = create_buywhere_tools(api_key="bw_live_...", base_url="https://api.buywhere.ai")
```

Get your API key at [buywhere.ai/api-keys](https://buywhere.ai/api-keys).
