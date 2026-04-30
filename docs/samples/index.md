# Code Samples

Working examples for integrating the BuyWhere API.

## Table of Contents

- [Python (Basic)](#python-basic)
- [Python (Async)](#python-async)
- [Python (LangChain Agent)](#python-langchain-agent)
- [JavaScript (Node.js)](#javascript-nodejs)
- [JavaScript (OpenAI Tools)](#javascript-openai-tools)
- [curl](#curl)

---

## Python (Basic)

### Search and Find Best Price

```python
from buywhere_sdk import BuyWhere

client = BuyWhere(api_key="bw_live_xxxxx")

# Search for products
results = client.search("dyson vacuum", limit=10)
print(f"Found {results.total} products")

# Find cheapest
cheapest = client.best_price("dyson vacuum")
print(f"Cheapest: {cheapest.name} at {cheapest.currency} {cheapest.price}")
print(f"Buy: {cheapest.affiliate_url}")
```

### Compare Products

```python
from buywhere_sdk import BuyWhere

client = BuyWhere(api_key="bw_live_xxxxx")

# Get a product first
results = client.search("nintendo switch oled", limit=1)
if results.items:
    product = results.items[0]
    
    # Compare prices across platforms
    comparison = client.get(f"/v1/products/compare?product_id={product.id}")
    print(f"Found {comparison['total_matches']} listings")
    
    for match in comparison['matches']:
        print(f"  {match['source']}: {match['currency']} {match['price']}")
```

### Browse Categories

```python
from buywhere_sdk import BuyWhere

client = BuyWhere(api_key="bw_live_xxxxx")

# List all categories
categories = client.list_categories()
print(f"Total categories: {categories.total}")

# Get top categories
for cat in categories.categories[:5]:
    print(f"  {cat.name}: {cat.count} products")
```

---

## Python (Async)

### Async Search with asyncio

```python
import asyncio
from buywhere_sdk import AsyncBuyWhere

async def main():
    async with AsyncBuyWhere(api_key="bw_live_xxxxx") as client:
        # Run multiple searches concurrently
        tasks = [
            client.search("iphone 15"),
            client.search("samsung galaxy s24"),
            client.search("google pixel 8"),
        ]
        results = await asyncio.gather(*tasks)
        
        for result in results:
            print(f"Found {result.total} {result.items[0].category if result.items else 'unknown'} products")

asyncio.run(main())
```

### Async Best Price Finder

```python
import asyncio
from buywhere_sdk import AsyncBuyWhere

async def find_cheapest_products(queries):
    async with AsyncBuyWhere(api_key="bw_live_xxxxx") as client:
        tasks = [client.best_price(q) for q in queries]
        return await asyncio.gather(*tasks)

async def main():
    products = await find_cheapest_products([
        "playstation 5",
        "xbox series x",
        "nintendo switch oled"
    ])
    
    for product in products:
        print(f"{product.name}: {product.currency} {product.price} at {product.source}")

asyncio.run(main())
```

---

## Python (LangChain Agent)

### Product Research Tool

```python
from buywhere_sdk import BuyWhere
from langchain.tools import Tool

def search_products(query: str) -> str:
    """
    Search for products by query string.
    
    Args:
        query: Product search query (e.g., "dyson vacuum cleaner")
    
    Returns:
        JSON string with search results
    """
    client = BuyWhere(api_key="bw_live_xxxxx")
    results = client.search(query, limit=5)
    
    if not results.items:
        return f"No products found for '{query}'"
    
    output = []
    for p in results.items:
        output.append(
            f"- {p.name}\n"
            f"  Price: {p.currency} {p.price}\n"
            f"  Source: {p.source}\n"
            f"  Rating: {p.rating or 'N/A'}\n"
            f"  URL: {p.affiliate_url}"
        )
    return "\n".join(output)

def get_best_price(query: str) -> str:
    """
    Find the cheapest listing for a product across all platforms.
    
    Args:
        query: Product name (e.g., "nintendo switch oled")
    
    Returns:
        JSON string with the best price deal
    """
    client = BuyWhere(api_key="bw_live_xxxxx")
    try:
        product = client.best_price(query)
        return (
            f"Best deal for '{query}':\n"
            f"- {product.name}\n"
            f"  Price: {product.currency} {product.price}\n"
            f"  Source: {product.source}\n"
            f"  Buy: {product.affiliate_url}"
        )
    except Exception as e:
        return f"No deals found for '{query}': {str(e)}"

# Create LangChain tools
product_search = Tool(
    name="product_search",
    func=search_products,
    description="Search for products and get top 5 results with prices"
)

best_price = Tool(
    name="best_price",
    func=get_best_price,
    description="Find the cheapest listing for a specific product"
)

tools = [product_search, best_price]
```

### Complete LangChain Agent Example

```python
from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain_openai import ChatOpenAI
from buywhere_sdk import BuyWhere
from langchain.tools import Tool

# Define tools
def search_tool(query: str) -> str:
    client = BuyWhere(api_key="bw_live_xxxxx")
    results = client.search(query, limit=3)
    return "\n".join([
        f"{p.name} | {p.currency} {p.price} | {p.source}"
        for p in results.items
    ])

def compare_tool(product_id: int) -> str:
    client = BuyWhere(api_key="bw_live_xxxxx")
    # Using compare endpoint
    import httpx
    resp = httpx.get(
        f"https://api.buywhere.ai/v1/products/compare",
        params={"product_id": product_id},
        headers={"Authorization": f"Bearer bw_live_xxxxx"}
    )
    return resp.text

tools = [
    Tool(name="search", func=search_tool, description="Search products"),
    Tool(name="compare", func=compare_tool, description="Compare prices across platforms"),
]

# Create agent
llm = ChatOpenAI(model="gpt-4")
agent = create_openai_functions_agent(llm, tools, prompt)
agent_executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# Run agent
result = agent_executor.invoke({
    "input": "Find the cheapest PS5 bundle in Singapore and compare prices across platforms"
})
```

---

## JavaScript (Node.js)

### Basic Search

```javascript
import BuyWhere from '@buywhere/sdk';

const client = new BuyWhere({ apiKey: 'bw_live_xxxxx' });

async function main() {
  // Search for products
  const results = await client.search({ query: 'dyson vacuum', limit: 10 });
  console.log(`Found ${results.total} products`);
  
  for (const product of results.items) {
    console.log(`${product.name} - ${product.currency} ${product.price}`);
    console.log(`  Buy: ${product.affiliate_url}`);
  }
}

main();
```

### Best Price Comparison

```javascript
import BuyWhere from '@buywhere/sdk';

const client = new BuyWhere({ apiKey: 'bw_live_xxxxx' });

async function findBestDeal(productName) {
  try {
    const cheapest = await client.bestPrice({ query: productName });
    console.log(`Best deal for ${productName}:`);
    console.log(`  ${cheapest.name}`);
    console.log(`  Price: ${cheapest.currency} ${cheapest.price}`);
    console.log(`  Source: ${cheapest.source}`);
    console.log(`  Link: ${cheapest.affiliate_url}`);
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      console.log(`No products found for ${productName}`);
    } else {
      throw error;
    }
  }
}

findBestDeal('nintendo switch oled');
```

---

## JavaScript (OpenAI Tools)

### OpenAI Functions/Tools Integration

```javascript
import BuyWhere from '@buywhere/sdk';

const client = new BuyWhere({ apiKey: 'bw_live_xxxxx' });

const tools = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description: 'Search for products by query string',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Product search query'
          },
          limit: {
            type: 'number',
            description: 'Number of results (default 5)',
            default: 5
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_best_price',
      description: 'Find the cheapest listing for a product across all platforms',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Product name to search for'
          }
        },
        required: ['query']
      }
    }
  }
];

async function handleToolCall(toolName, args) {
  switch (toolName) {
    case 'search_products':
      const results = await client.search(args);
      return JSON.stringify(results);
      
    case 'get_best_price':
      const cheapest = await client.bestPrice(args);
      return JSON.stringify(cheapest);
      
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// Usage with OpenAI
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Find the cheapest PS5 bundle' }],
  tools: tools,
  tool_choice: 'auto'
});

const toolCall = response.choices[0].message.tool_calls[0];
const result = await handleToolCall(toolCall.function.name, JSON.parse(toolCall.function.arguments));
console.log(result);
```

---

## curl

### Basic Search

```bash
curl -s "https://api.buywhere.ai/v1/search?q=dyson%20vacuum&limit=5" \
  -H "Authorization: Bearer bw_live_xxxxx" \
  -H "Accept: application/json" | jq .
```

### Search with Filters

```bash
# Filter by price range and platform
curl -s "https://api.buywhere.ai/v1/search?q=laptop&min_price=500&max_price=2000&platform=shopee_sg" \
  -H "Authorization: Bearer bw_live_xxxxx" | jq '.items[] | {name, price, source}'
```

### Get Single Product

```bash
curl -s "https://api.buywhere.ai/v1/products/12345" \
  -H "Authorization: Bearer bw_live_xxxxx" | jq .
```

### Find Best Price

```bash
curl -s "https://api.buywhere.ai/v1/products/best-price?q=nintendo%20switch%20oled" \
  -H "Authorization: Bearer bw_live_xxxxx" | jq .
```

### Compare Products

```bash
curl -s "https://api.buywhere.ai/v1/products/compare?product_id=12345" \
  -H "Authorization: Bearer bw_live_xxxxx" | jq '.matches[] | {source, price, match_score}'
```

### Compare Diff (Multiple Products)

```bash
curl -s -X POST "https://api.buywhere.ai/v1/products/compare/diff" \
  -H "Authorization: Bearer bw_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"product_ids": [12345, 67890, 11111]}' | jq .
```

### List Categories

```bash
curl -s "https://api.buywhere.ai/v1/categories" \
  -H "Authorization: Bearer bw_live_xxxxx" | jq '.categories[:10]'
```

### Export Products (CSV)

```bash
curl -s "https://api.buywhere.ai/v1/products/export?format=csv&limit=100" \
  -H "Authorization: Bearer bw_live_xxxxx" \
  -o products.csv
```

### Check Health

```bash
curl -s "https://api.buywhere.ai/health" | jq .
```