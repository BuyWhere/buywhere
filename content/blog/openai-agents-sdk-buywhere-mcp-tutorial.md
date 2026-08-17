---
slug: "openai-agents-sdk-buywhere-mcp-tutorial"
title: "OpenAI Agents SDK + BuyWhere MCP: Build a Shopping Agent in 2026"
description: "Step-by-step tutorial: connect OpenAI Agents SDK to the BuyWhere MCP server (300M+ products, free tier) and build a shopping agent that searches, compares, and tracks deals. Python + Node.js code, full project structure."
author: "BuyWhere Team"
publishedAt: "2026-08-18"
lastUpdatedAt: "2026-08-18"
tags: ["openai-agents-sdk", "mcp", "shopping-agent", "tutorial", "ai-agents", "developer-guide"]
jsonLd: >
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "headline": "OpenAI Agents SDK + BuyWhere MCP: Build a Shopping Agent in 2026",
        "description": "Connect OpenAI Agents SDK to BuyWhere MCP and build a shopping agent that searches 300M+ products, compares prices, and tracks deals. Step-by-step tutorial with Python and Node.js code.",
        "datePublished": "2026-08-18",
        "dateModified": "2026-08-18",
        "author": { "@type": "Organization", "name": "BuyWhere Team", "url": "https://buywhere.ai" },
        "publisher": {
          "@type": "Organization",
          "name": "BuyWhere",
          "url": "https://buywhere.ai",
          "logo": { "@type": "ImageObject", "url": "https://buywhere.ai/logo.png" }
        },
        "mainEntityOfPage": "https://buywhere.ai/blog/openai-agents-sdk-buywhere-mcp-tutorial"
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "Does the OpenAI Agents SDK support MCP?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. The OpenAI Agents SDK supports MCP servers via the host wrapper layer (MCPServerStdio or MCPServerStreamableHttp). You give it the BuyWhere MCP URL and the SDK automatically registers the five commerce tools (search_products, get_deals, compare_prices, get_price_history, get_retailers) for the agent to use."
            }
          },
          {
            "@type": "Question",
            "name": "Do I need an API key for BuyWhere MCP?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "No — the public BuyWhere MCP server at https://api.buywhere.ai/mcp is open and does not require an API key for basic tool calls. For higher rate limits (1,000/min vs 100/min), pass an Authorization header with a Bearer key from buywhere.ai/api-keys."
            }
          },
          {
            "@type": "Question",
            "name": "What's the simplest OpenAI Agents SDK + BuyWhere MCP example?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "12 lines of Python: import AsyncOpenAI from openai-agents, wrap the BuyWhere MCP URL with MCPServerStreamableHttp, define an Agent with instructions, run Runner.run(agent, 'Find the cheapest iPhone 17 in Singapore'). The agent automatically calls search_products and returns a structured answer."
            }
          }
        ]
      }
    ]
  }
---

# OpenAI Agents SDK + BuyWhere MCP: Build a Shopping Agent in 2026

The OpenAI Agents SDK has first-class support for MCP servers. BuyWhere ships a production MCP server at `https://api.buywhere.ai/mcp`. Wiring them together takes 12 lines of Python.

**Quick Answer:** Wrap the BuyWhere MCP URL with `MCPServerStreamableHttp`, define an Agent with `instructions`, and let the SDK auto-register the five commerce tools. The agent calls `search_products`, `compare_prices`, etc. on its own.

## What you need

- Python 3.10+ (or Node.js 18+)
- `openai-agents` package (`pip install openai-agents`)
- OpenAI API key (`OPENAI_API_KEY`)
- Optional: BuyWhere API key for higher rate limits

## The 12-line agent

```bash
pip install openai-agents
```

```python
# agent.py
import asyncio
from agents import Agent, Runner
from agents.mcp import MCPServerStreamableHttp

BUYWHERE_MCP = "https://api.buywhere.ai/mcp"

async def main():
    async with MCPServerStreamableHttp(
        name="buywhere",
        params={"url": BUYWHERE_MCP},
        cache_tools_list=True,
    ) as server:
        agent = Agent(
            name="shopping-assistant",
            instructions=(
                "You help users find products and compare prices. "
                "Use the BuyWhere MCP tools to search, compare, and surface deals. "
                "Always cite the merchant and price in your final answer."
            ),
            mcp_servers=[server],
        )
        result = await Runner.run(
            agent,
            "Find the cheapest iPhone 17 (256GB) in Singapore right now and tell me which merchant has it.",
        )
        print(result.final_output)

asyncio.run(main())
```

Run it:

```bash
OPENAI_API_KEY=sk-... python agent.py
```

The agent will:
1. Call `search_products(q="iPhone 17 256GB", country_code="SG")`
2. Read the results, pick the lowest
3. Return a natural-language answer with merchant + price

That's it. The MCP server is open (no API key needed for basic use). The SDK handles the rest.

## What the agent can do

The MCP server exposes five tools:

| Tool | Use case |
| --- | --- |
| `search_products` | Find products by query, filter by country/brand/price |
| `compare_prices` | Compare prices for a specific product across merchants |
| `get_price_history` | Historical price for a product — useful for "is this a good price?" |
| `get_deals` | Current deals in a country, filterable by min discount |
| `get_retailers` | List supported retailers by region |

The agent picks the right tool based on the user's question. Most multi-turn shopping conversations use 2–4 of these.

## Project structure for a real shopping agent

```
my-shopping-agent/
├── agent.py            # Main agent definition
├── tools.py            # Custom tool wrappers (e.g., currency conversion)
├── prompts.py          # System prompts for different agent personas
├── config.py           # Model, MCP server, API keys
├── tests/
│   └── test_agent.py
└── pyproject.toml
```

A real agent typically combines BuyWhere MCP with 1–2 custom tools (e.g., a notification tool that sends a Telegram message when a price drops, or a memory tool that tracks the user's preferences).

## Adding a custom tool

```python
from agents import function_tool

@function_tool
async def send_telegram(message: str) -> str:
    """Send a message to the user via Telegram."""
    # ... your Telegram bot integration
    return "sent"

agent = Agent(
    name="shopping-assistant",
    instructions="...your instructions...",
    tools=[send_telegram],
    mcp_servers=[server],
)
```

The agent now has access to both the BuyWhere MCP tools and your custom `send_telegram` tool. It will pick the right one based on the user's request.

## Using a BuyWhere API key for higher rate limits

```python
async with MCPServerStreamableHttp(
    name="buywhere",
    params={
        "url": BUYWHERE_MCP,
        "headers": {"Authorization": f"Bearer {BUYWHERE_API_KEY}"},
    },
    cache_tools_list=True,
) as server:
    ...
```

For production agents, this raises the rate limit from 100/min to 1,000/min.

## Node.js version

```bash
npm install @openai/agents zod
```

```javascript
// agent.mjs
import { Agent, run } from "@openai/agents";
import { MCPServerStreamableHttp } from "@openai/agents/mcp";

const server = new MCPServerStreamableHttp({
  url: "https://api.buywhere.ai/mcp",
  name: "buywhere",
});

const agent = new Agent({
  name: "shopping-assistant",
  instructions: "Use the BuyWhere MCP tools to help users find products and compare prices.",
  mcpServers: [server],
});

const result = await run(agent, "Find the cheapest AirPods Pro 2 in Singapore right now.");
console.log(result.finalOutput);
```

Same shape. The Node SDK uses the same MCP server.

## Common patterns

### Multi-turn with memory

The OpenAI Agents SDK has session memory out of the box:

```python
from agents import Runner

result = await Runner.run(agent, "What's the cheapest iPhone 17 in SG?", session=session)
result = await Runner.run(agent, "What about the 512GB version?", session=session)  # remembers the previous context
```

### Streaming

```python
from agents import Runner

result = Runner.run_streamed(agent, "Find me a deal on a Dyson V15 in Singapore.")
async for event in result.stream_events():
    if event.type == "tool_call":
        print(f"Tool: {event.tool.name}")
    elif event.type == "tool_result":
        print(f"Result: {event.result}")
```

### Guardrails

```python
from agents import input_guardrail, GuardrailFunctionOutput

@input_guardrail
async def block_off_topic(ctx, agent, input):
    blocked = ["crypto", "stocks", "any non-shopping query"]
    if any(b in input.lower() for b in blocked):
        return GuardrailFunctionOutput(
            output_info={"blocked": True},
            tripwire_triggered=True,
        )
    return GuardrailFunctionOutput(output_info={"blocked": False}, tripwire_triggered=False)
```

The agent will refuse off-topic queries without consuming an MCP call.

## Verdict

The OpenAI Agents SDK + BuyWhere MCP combo is the fastest way to build a shopping agent in 2026. 12 lines of Python gets you a working agent; the MCP server handles all the commerce complexity.

## Common questions

**Does the agent need a BuyWhere API key?** No for basic use. The MCP server is open. For higher rate limits, pass an API key.

**Can I use this with GPT-4o or GPT-5?** Yes — the OpenAI Agents SDK supports any OpenAI model. GPT-4o is the default; GPT-5 is recommended for complex multi-turn shopping.

**Does the agent call the MCP server for every turn?** No — the SDK caches the tool list, so the agent only calls the MCP server when it actually needs a tool result.

## Where to go next

- BuyWhere MCP setup → [buywhere.ai/docs/guides/mcp-integration](https://buywhere.ai/docs/guides/mcp-integration)
- OpenAI Agents SDK → [github.com/openai/openai-agents-python](https://github.com/openai/openai-agents-python)
- Sign up → [buywhere.ai/api-keys](https://buywhere.ai/api-keys)
