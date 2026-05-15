# buywhere-llamaindex

BuyWhere LlamaIndex integration — product search, price comparison, and deals as LlamaIndex tools.

## Installation

```bash
pip install buywhere-llamaindex
```

## Quick Start

```python
from buywhere import BuyWhereClient
from buywhere_llamaindex import create_buywhere_tools

client = BuyWhereClient(api_key="bw_...")
tools = create_buywhere_tools(client)

# Use with any LlamaIndex agent
from llama_index.core.agent import FunctionCallingAgent
from llama_index.llms.openai import OpenAI

llm = OpenAI(model="gpt-4o-mini")
agent = FunctionCallingAgent.from_tools(tools, llm=llm)
response = agent.chat("Find me wireless headphones under $100 in Singapore")
```

## Tools Included

| Tool | Description |
|------|-------------|
| `buywhere_search_products` | Search the product catalog by query |
| `buywhere_compare_prices` | Compare prices across merchants for a product |
| `buywhere_get_deals` | Find current deals and price drops |
| `buywhere_get_product_details` | Get detailed info about a specific product |

## Using BuyWhereToolSpec

For more control, use the `BuyWhereToolSpec` class directly:

```python
from buywhere import BuyWhereClient
from buywhere_llamaindex import BuyWhereToolSpec

client = BuyWhereClient(api_key="bw_...")
spec = BuyWhereToolSpec(client)
tools = spec.to_tool_list()
```

## Requirements

- Python 3.9+
- `buywhere>=0.2.0`
- `llama-index-core>=0.10.0`

## License

MIT
