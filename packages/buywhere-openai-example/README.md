# BuyWhere OpenAI Integration

Search, compare, and shop BuyWhere's product catalog using OpenAI function calling.

## Quickstart

### 1. Get an API key

```bash
curl -X POST https://api.buywhere.ai/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "my-shopping-bot"}'
```

### 2. Install the package

**TypeScript / JavaScript:**
```bash
npm install @buywhere/openai-tools
```

**Python:**
```bash
pip install buywhere-openai
```

### 3. Use it

**Python (Chat Completions):**
```python
import os
from openai import OpenAI
from buywhere_openai import BuyWhereTools, BuyWhereClient

client = OpenAI()
bw = BuyWhereClient(api_key=os.environ["BUYWHERE_API_KEY"])

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": "Find me the cheapest Sony headphones in Singapore"}
    ],
    tools=BuyWhereTools,
    tool_choice="auto",
)

if response.choices[0].finish_reason == "tool_calls":
    for tool_call in response.choices[0].message.tool_calls:
        result = bw.dispatch(tool_call.model_dump())
        print(result)
```

**TypeScript:**
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

## Available Tools

| Tool | Description |
|------|-------------|
| `search_products` | Search catalog by keyword, price range, platform, region, country |
| `get_product` | Full product details and current price by ID |
| `compare_products` | Side-by-side comparison of 2–10 products |
| `get_deals` | Discounted products sorted by discount percentage |
| `list_categories` | Browse available product categories |

## Examples

- `examples/chatbot.py` — Simple product search chatbot (Python, Chat Completions)
- `examples/price_comparison.ts` — Price comparison agent (TypeScript)
- `examples/availability_checker.py` — Stock monitoring agent (Python)

## API Reference

Base URL: `https://api.buywhere.ai`

Authentication: `Authorization: Bearer <your-api-key>`

See full docs at [https://api.buywhere.ai/docs/guides/mcp](https://api.buywhere.ai/docs/guides/mcp)
