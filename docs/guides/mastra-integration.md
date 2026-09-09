---
title: "Mastra Integration"
description: "Mastra(https://mastra.ai) is a TypeScript-first AI agent framework with native Model Context Protocol (MCP)(https://modelcontextprotocol.io) support.…"
public: true
---

# BuyWhere + Mastra

[Mastra](https://mastra.ai) is a TypeScript-first AI agent framework with native [Model Context Protocol (MCP)](https://modelcontextprotocol.io) support. Because BuyWhere ships an MCP-compatible endpoint, you can connect BuyWhere tools to any Mastra agent in minutes.

## What You Get

Once connected, your Mastra agent has access to:

| Tool | Description |
|------|-------------|
| `search_products` | Keyword search with country, category, and price filters |
| `get_product` | Full product details by ID |
| `compare_products` | Side-by-side comparison across merchants |
| `get_deals` | Current discounted products |
| `find_best_price` | Cheapest option across all retailers |
| `list_categories` | Product category taxonomy |

## Prerequisites

- Node.js 18+
- A BuyWhere API key — get one free at [buywhere.ai/api-keys](https://buywhere.ai/api-keys) — or let your agent self-register in one call (no email, no human): `curl -X POST "https://api.buywhere.ai/v1/auth/register?verify=false" -H "Content-Type: application/json" -d '{"agent_name":"my-agent"}'`
- Mastra `0.2.0` or later

## Quick Start

```bash
npm install @mastra/core @mastra/mcp
```

```typescript

const buywhere = new MastraMCPClient({
  name: 'buywhere',
  server: {
    url: new URL('https://api.buywhere.ai/mcp'),
    requestInit: {
      headers: {
        'Authorization': `Bearer ${process.env.BUYWHERE_API_KEY}`,
      },
    },
  },
});

const mastra = new Mastra({
  agents: {
    shoppingAgent: {
      name: 'Shopping Agent',
      instructions: `You are a helpful shopping assistant. Use BuyWhere tools to 
find products, compare prices across merchants, and identify the best deals 
in Singapore, US, and Southeast Asia. Always include affiliate links.`,
      model: {
        provider: 'ANTHROPIC',
        name: 'claude-3-5-sonnet-20241022',
      },
      tools: await buywhere.getTools(),
    },
  },
});

const agent = mastra.getAgent('shoppingAgent');
const result = await agent.text(
  'Find me the best price for AirPods Pro in Singapore'
);
console.log(result.text);
```

## Full Working Example

Clone the runnable example repository:

```bash
git clone https://github.com/BuyWhere/buywhere-mastra-example
cd buywhere-mastra-example
npm install
BUYWHERE_API_KEY=bw_live_... npm start
```

The example demonstrates:
- Connecting BuyWhere MCP to a Mastra agent
- Multi-turn shopping conversations
- Price comparison across merchants
- Streaming responses

## Step-by-Step Setup

### 1. Install dependencies

```bash
npm install @mastra/core @mastra/mcp @anthropic-ai/sdk
```

### 2. Configure the MCP client

```typescript

const buywhere = new MastraMCPClient({
  name: 'buywhere',
  server: {
    url: new URL('https://api.buywhere.ai/mcp'),
    requestInit: {
      headers: {
        'Authorization': `Bearer ${process.env.BUYWHERE_API_KEY}`,
      },
    },
  },
});

// List available tools
const tools = await buywhere.getTools();
console.log('Available tools:', Object.keys(tools));
```

### 3. Create an agent

```typescript

const mastra = new Mastra({
  agents: {
    shopping: {
      name: 'BuyWhere Shopping Agent',
      instructions: 'You help users find the best prices for products.',
      model: {
        provider: 'ANTHROPIC',
        name: 'claude-3-5-sonnet-20241022',
      },
      tools: await buywhere.getTools(),
    },
  },
});

const agent = mastra.getAgent('shopping');
```

### 4. Run queries

```typescript
// Simple text query
const response = await agent.text('What laptops are available under SGD 2000?');
console.log(response.text);

// Streaming response
const stream = await agent.stream('Compare prices for iPhone 15 Pro');
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BUYWHERE_API_KEY` | Your BuyWhere API key | Yes |

## Error Handling

```typescript
try {
  const tools = await buywhere.getTools();
  // ...
} catch (error) {
  if (error.message.includes('401')) {
    console.error('Invalid API key — check BUYWHERE_API_KEY');
  } else {
    console.error('BuyWhere connection failed:', error.message);
  }
}
```

## Supported Regions

| Region | Country Codes |
|--------|---------------|
| Singapore | `sg` |
| Malaysia | `my` |
| Thailand | `th` |
| Vietnam | `vn` |
| Indonesia | `id` |
| United States | `us` |

Pass a region with the `search_products` tool:

```typescript
// The agent passes parameters automatically based on your query:
await agent.text('Find gaming chairs in Malaysia under MYR 800');
// → searches with country_code: "my"
```

## Resources

- [BuyWhere API Reference](https://buywhere.ai/docs/api-reference/search)
- [Mastra Documentation](https://mastra.ai/docs)
- [BuyWhere MCP Guide](./mcp-integration.md)
- [Example repository](https://github.com/BuyWhere/buywhere-mastra-example)
- [npm: @buywhere/mcp-server](https://www.npmjs.com/package/@buywhere/mcp-server)
