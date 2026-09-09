# buywhere-openai

BuyWhere product search, price comparison, and deals as OpenAI function calling tools for AI agents.

```bash
pip install buywhere-openai
```

## Usage

### Chat Completions

```python
import os
from openai import OpenAI
from buywhere_openai import BuyWhereTools, BuyWhereClient

client = OpenAI()
bw = BuyWhereClient(api_key=os.environ["BUYWHERE_API_KEY"])

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Find me the cheapest Sony headphones in Singapore"}],
    tools=BuyWhereTools,
    tool_choice="auto",
)

if response.choices[0].finish_reason == "tool_calls":
    for tool_call in response.choices[0].message.tool_calls:
        result = bw.dispatch(tool_call.model_dump())
        print(result)
```

### Async

```python
import asyncio
from buywhere_openai import BuyWhereClient

async def main():
    bw = BuyWhereClient(api_key="bw_live_xxx")
    result = await bw.search_products_async(q="wireless headphones")
    print(result)

asyncio.run(main())
```

### Legacy Functions Format

```python
from buywhere_openai import BuyWhereTools_as_functions

functions = BuyWhereTools_as_functions()
```

## API

### `BuyWhereTools`

List of 5 OpenAI function-calling tool definitions.

### `BuyWhereClient`

| Method | Description |
|--------|-------------|
| `dispatch(tool_call)` | Execute a tool call synchronously |
| `dispatch_async(tool_call)` | Execute a tool call asynchronously |
| `search_products(**params)` | Search products with keyword, filters, pagination |
| `search_products_async(**params)` | Async variant |
| `get_product(product_id)` | Get product details by ID |
| `get_product_async(product_id)` | Async variant |
| `compare_products(ids)` | Compare 2-10 products |
| `compare_products_async(ids)` | Async variant |
| `get_deals(**params)` | Get discounted products |
| `get_deals_async(**params)` | Async variant |
| `list_categories(**params)` | List product categories |
| `list_categories_async(**params)` | Async variant |

### `BuyWhereTools_as_functions()`

Convert tools to legacy Chat Completions `functions` format.
