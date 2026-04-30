# Quickstart: Query Singapore Products in 5 Minutes

Get your first API response in under 5 minutes. This guide gets developers with no prior BuyWhere knowledge from zero to their first successful API call.

## Prerequisites

- An API key from [buywhere.ai/developers](https://buywhere.ai/developers)
- curl, Python 3.8+, or any HTTP client

## Step 1: Get Your API Key

1. Sign up at [buywhere.ai/developers](https://buywhere.ai/developers)
2. Create a new API key from your dashboard
3. Copy your key — it starts with `bw_live_`:

```
bw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Step 2: Make Your First Search

Search Singapore products using the `/v1/search` endpoint. Filter by country using the `source` parameter (e.g., `shopee_sg`, `lazada_sg`).

### Using curl

```bash
curl -X GET "https://api.buywhere.ai/v1/search?q=wireless+headphones&source=shopee_sg&limit=5" \
  -H "Authorization: Bearer bw_live_xxxxx" \
  -H "Accept: application/json"
```

**Response:**

```json
{
  "total": 248,
  "limit": 5,
  "offset": 0,
  "has_more": true,
  "items": [
    {
      "id": 78234,
      "sku": "SHOPEE-SG-HEP-001",
      "source": "shopee_sg",
      "merchant_id": "shop_abc123",
      "name": "Sony WH-1000XM5 Wireless Headphones",
      "description": "Industry-leading noise cancellation...",
      "price": "449.00",
      "currency": "SGD",
      "buy_url": "https://shopee.sg/product/12345",
      "affiliate_url": "https://buywhere.ai/track/abc123",
      "image_url": "https://...jpg",
      "brand": "Sony",
      "category": "Headphones",
      "category_path": ["Electronics", "Audio", "Headphones"],
      "rating": "4.8",
      "is_available": true,
      "last_checked": "2026-04-03T12:00:00Z",
      "updated_at": "2026-04-03T14:30:00Z"
    }
  ]
}
```

**Key response fields:**

| Field | Description |
|-------|-------------|
| `id` | Unique BuyWhere product ID |
| `name` | Product title |
| `price` | Price in `currency` |
| `currency` | Currency code (e.g., `SGD`) |
| `source` | Platform (e.g., `shopee_sg`, `lazada_sg`) |
| `affiliate_url` | Tracked link — use this to send traffic and earn commission |

### Using Python

```python
from buywhere_sdk import BuyWhere

client = BuyWhere(api_key="bw_live_xxxxx")

# Search Singapore products
results = client.search(
    query="wireless headphones",
    source="shopee_sg",
    limit=5
)

for product in results.items:
    print(f"{product.name}")
    print(f"  Price: {product.currency} {product.price}")
    print(f"  Source: {product.source}")
    print(f"  Buy: {product.affiliate_url}")
    print()
```

### Using JavaScript (Node.js)

```javascript
import BuyWhere from '@buywhere/sdk';

const client = new BuyWhere({ apiKey: 'bw_live_xxxxx' });

const results = await client.search({
  query: 'wireless headphones',
  source: 'shopee_sg',
  limit: 5
});

for (const product of results.items) {
  console.log(`${product.name} - ${product.currency} ${product.price}`);
  console.log(`  Buy: ${product.affiliate_url}`);
}
```

## Step 3: Use in a Python AI Agent

The BuyWhere LangChain toolkit lets AI agents search products, get details, and find the best prices.

```python
from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain_openai import ChatOpenAI
from buywhere_sdk.langchain import BuyWhereToolkit

# Initialize the toolkit with your API key
toolkit = BuyWhereToolkit(api_key="bw_live_xxxxx")
tools = toolkit.get_tools()

# Create an agent with BuyWhere tools
llm = ChatOpenAI(model="gpt-4", temperature=0)
agent = create_openai_functions_agent(llm, tools, prompt)
agent_executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# Run the agent
result = agent_executor.invoke({
    "input": "Find the cheapest PS5 bundle in Singapore and compare prices across platforms"
})
print(result["output"])
```

**What the agent can do:**

| Tool | Description |
|------|-------------|
| `buywhere_search` | Search products by query, category, price range |
| `buywhere_get_product` | Get product details by BuyWhere ID |
| `buywhere_best_price` | Find the cheapest listing across all platforms |

**Example tool output:**

```
Best Price Found: Sony WH-1000XM5 Wireless Headphones
Price: SGD 449.00
Source: shopee_sg
Buy URL: https://shopee.sg/product/12345
```

## Step 4: Find the Best Price

```bash
curl -X GET "https://api.buywhere.ai/v1/products/best-price?q=nintendo%20switch%20oled" \
  -H "Authorization: Bearer bw_live_xxxxx"
```

```python
cheapest = client.best_price("nintendo switch oled")
print(f"Cheapest: {cheapest.name} at {cheapest.currency} {cheapest.price}")
print(f"From: {cheapest.source}")
```

## Step 5: Compare Prices Across Platforms

```bash
curl -X GET "https://api.buywhere.ai/v1/products/compare?product_id=12345" \
  -H "Authorization: Bearer bw_live_xxxxx"
```

```python
comparison = client.compare_prices("nintendo switch oled")
print(f"Found {comparison.total_matches} listings across platforms")

for match in comparison.matches:
    print(f"  {match.source}: {match.currency} {match.price} (score: {match.match_score})")
```

## Step 6: Browse Categories

```bash
curl -X GET "https://api.buywhere.ai/v1/categories" \
  -H "Authorization: Bearer bw_live_xxxxx"
```

```python
categories = client.list_categories()

for cat in categories.categories[:10]:
    print(f"{cat.name}: {cat.count} products")
```

## Common Use Cases

### Filter by Price Range

```bash
curl "https://api.buywhere.ai/v1/search?q=laptop&min_price=500&max_price=2000" \
  -H "Authorization: Bearer bw_live_xxxxx"
```

### Filter by Platform

```bash
curl "https://api.buywhere.ai/v1/search?q=iphone&source=shopee_sg" \
  -H "Authorization: Bearer bw_live_xxxxx"
```

### Filter by Category

```bash
curl "https://api.buywhere.ai/v1/search?q=camera&category=Electronics" \
  -H "Authorization: Bearer bw_live_xxxxx"
```

## Next Steps

- [API Reference](api-reference/index.md) — Full endpoint documentation
- [Authentication Guide](guides/authentication.md) — Rate limits, error codes
- [Code Samples](samples/index.md) — LangChain, OpenAI tools, CrewAI examples
- [SDK Reference](https://github.com/buywhere/sdk) — Python SDK source