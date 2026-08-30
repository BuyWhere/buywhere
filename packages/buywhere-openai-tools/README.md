# @buywhere/openai-tools

BuyWhere product search, price comparison, and deals as OpenAI function calling tools for AI agents.

```bash
npm install @buywhere/openai-tools
```

## Usage

```typescript
import { BuyWhereTools, BuyWhereClient } from "@buywhere/openai-tools";
import OpenAI from "openai";

const bw = new BuyWhereClient({ apiKey: process.env.BUYWHERE_API_KEY! });
const openai = new OpenAI();

const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Cheapest Sony headphones in Singapore" }],
  tools: BuyWhereTools,
  tool_choice: "auto",
});

if (response.choices[0].finish_reason === "tool_calls") {
  for (const toolCall of response.choices[0].message.tool_calls!) {
    const result = await bw.dispatch(toolCall);
    console.log(result);
  }
}
```

## API

### `BuyWhereTools`

Array of 5 OpenAI function-calling tool definitions:

| Tool | Description |
|------|-------------|
| `search_products` | Search catalog by keyword, price range, platform, region, country |
| `get_product` | Full product details and current price by ID |
| `compare_products` | Side-by-side comparison of 2–10 products |
| `get_deals` | Discounted products sorted by discount percentage |
| `list_categories` | Browse available product categories |

### `BuyWhereClient`

| Method | Description |
|--------|-------------|
| `dispatch(toolCall)` | Executes a tool call and returns the result |
| `searchProducts(params)` | Search products with keyword, filters, pagination |
| `getProduct(id)` | Get product details by ID |
| `compareProducts(ids)` | Compare 2-10 products |
| `getDeals(params)` | Get discounted products |
| `listCategories(params)` | List product categories |

### `BuyWhereToolName`

Type union of the 5 tool names: `"search_products" | "get_product" | "compare_products" | "get_deals" | "list_categories"`
