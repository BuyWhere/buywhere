# BuyWhere + Mastra Example

Runnable example showing how to connect [BuyWhere](https://buywhere.ai) to a [Mastra](https://mastra.ai) AI agent for product search, price comparison, and deal discovery.

## Quick Start

```bash
git clone https://github.com/BuyWhere/buywhere-mastra-example
cd buywhere-mastra-example
npm install

# Set your API keys
export BUYWHERE_API_KEY=bw_live_...
export ANTHROPIC_API_KEY=sk-ant-...   # optional — needed for full LLM queries

npm start
```

## What It Does

1. Connects to BuyWhere's HTTP MCP endpoint at `https://api.buywhere.ai/mcp`
2. Lists all available BuyWhere tools (search_products, compare_products, etc.)
3. Creates a Mastra agent with those tools attached
4. Runs shopping queries:
   - "Search for wireless earbuds in Singapore under SGD 100"
   - "What is the cheapest laptop available in the US right now?"
   - "Compare prices for a standing desk in Malaysia"

## Requirements

- Node.js 18+
- BuyWhere API key (free at [buywhere.ai/api-keys](https://buywhere.ai/api-keys))
- Anthropic API key (for full LLM responses; tool listing works without it)

## Resources

- [Full integration guide](https://buywhere.ai/docs/guides/mastra-integration)
- [BuyWhere MCP documentation](https://buywhere.ai/docs/guides/mcp-integration)
- [Mastra documentation](https://mastra.ai/docs)
- [BuyWhere API Reference](https://buywhere.ai/api-reference)
