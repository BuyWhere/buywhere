---
slug: "claude-managed-agents-buywhere-mcp-example"
title: "Connect Claude Managed Agents to BuyWhere MCP: A Complete Shopping-Agent Example"
description: "A copy-pasteable BuyWhere MCP example for Claude Managed Agents: register a reusable agent, attach the hosted BuyWhere MCP endpoint, run a buyer-safe product search with deliver_to, and fall back to raw JSON-RPC when a client cannot use Managed Agents."
author: "BuyWhere Team"
publishedAt: "2026-08-26"
lastUpdatedAt: "2026-08-26"
tags: ["mcp", "claude", "managed-agents", "ai-agents", "shopping-agent", "developer-tools"]
jsonLd: >
  {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "headline": "Connect Claude Managed Agents to BuyWhere MCP: A Complete Shopping-Agent Example",
    "description": "A copy-pasteable BuyWhere MCP example for Claude Managed Agents: register a reusable agent, attach the hosted BuyWhere MCP endpoint, run a buyer-safe product search with deliver_to, and fall back to raw JSON-RPC when a client cannot use Managed Agents.",
    "datePublished": "2026-08-26",
    "dateModified": "2026-08-26",
    "author": { "@type": "Organization", "name": "BuyWhere Team", "url": "https://buywhere.ai" },
    "publisher": { "@type": "Organization", "name": "BuyWhere", "url": "https://buywhere.ai" },
    "mainEntityOfPage": "https://buywhere.ai/blog/claude-managed-agents-buywhere-mcp-example"
  }
---

# Connect Claude Managed Agents to BuyWhere MCP: A Complete Shopping-Agent Example

BuyWhere's hosted MCP server gives shopping agents live product search, best-price discovery, deal lookup, comparison, and catalog tools without scraping merchant pages directly. This example shows a Claude Managed Agents setup that can answer a buyer question such as:

> Find the cheapest Sony WH-1000XM5 headphones that can ship to Singapore, then show two alternatives.

The important buyer-safety rule is simple: pass `deliver_to` whenever the answer is for a real shopper. Merchant country and shopper delivery country are different concepts; `deliver_to` tells BuyWhere where the product must be deliverable.

## What you will build

- A reusable Claude Managed Agent configured once.
- A hosted MCP connection to `https://api.buywhere.ai/mcp`.
- A runtime session that asks BuyWhere for products using `deliver_to`.
- A raw JSON-RPC fallback for MCP clients that do not yet support Managed Agents.

## Prerequisites

- Python 3.10+.
- `pip install anthropic`.
- An Anthropic credential available through `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or an active `ant auth login` profile.
- A BuyWhere API key from the BuyWhere API keys page.

Do not put API keys in prompts, checked-in files, or agent instructions. Keep them in environment variables or a Managed Agents vault.

## 1. Create the reusable agent once

Managed Agents use a two-step lifecycle: create an agent configuration once, then create a session for each task. The model, system prompt, tools, and MCP server live on the agent object.

```python
# setup_buywhere_agent.py
import anthropic

client = anthropic.Anthropic()

agent = client.beta.agents.create(
    name="BuyWhere Shopping MCP Agent",
    model="claude-opus-5",
    system=(
        "You are a buyer-safe shopping assistant. Use BuyWhere MCP for live "
        "product and price answers. For shopper-facing recommendations, always "
        "include deliver_to in MCP calls and prefer deliverable products over "
        "nominally cheaper undeliverable listings."
    ),
    mcp_servers=[
        {
            "type": "url",
            "name": "buywhere",
            "url": "https://api.buywhere.ai/mcp",
        }
    ],
    tools=[
        {"type": "agent_toolset_20260401"},
        {"type": "mcp_toolset", "mcp_server_name": "buywhere"},
    ],
)

print(agent.id)
print(agent.version)
```

Save the printed `agent.id`. Reuse it for every future session instead of creating a new agent per request.

## 2. Store the BuyWhere MCP credential in a vault

The agent definition declares the MCP server URL but does not contain secrets. Store the BuyWhere API key in a vault, then attach that vault when creating sessions.

```python
# setup_buywhere_vault.py
import os
import anthropic

client = anthropic.Anthropic()

vault = client.beta.vaults.create(name="BuyWhere MCP credentials")

client.beta.vaults.credentials.create(
    vault.id,
    display_name="BuyWhere API key",
    auth={
        "type": "static_bearer",
        "mcp_server_url": "https://api.buywhere.ai/mcp",
        "token": os.environ["BUYWHERE_API_KEY"],
    },
)

print(vault.id)
```

Save the printed `vault.id` next to the agent ID.

## 3. Run a shopping session

```python
# run_buywhere_mcp_session.py
import os
import anthropic

client = anthropic.Anthropic()

AGENT_ID = os.environ["BUYWHERE_AGENT_ID"]
ENVIRONMENT_ID = os.environ["ANTHROPIC_ENVIRONMENT_ID"]
VAULT_ID = os.environ["BUYWHERE_VAULT_ID"]

session = client.beta.sessions.create(
    agent=AGENT_ID,
    environment_id=ENVIRONMENT_ID,
    vault_ids=[VAULT_ID],
    title="BuyWhere MCP shopping query",
)

print(f"Trace: https://platform.claude.com/workspaces/default/sessions/{session.id}")

with client.beta.sessions.events.stream(session_id=session.id) as stream:
    client.beta.sessions.events.send(
        session_id=session.id,
        events=[
            {
                "type": "user.message",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Use BuyWhere MCP to find Sony WH-1000XM5 headphones "
                            "for a shopper in Singapore. Pass deliver_to='SG'. "
                            "Return the cheapest deliverable option and two alternatives."
                        ),
                    }
                ],
            }
        ],
    )

    for event in stream:
        if event.type == "agent.message":
            for block in event.content:
                if block.type == "text":
                    print(block.text, end="", flush=True)
        elif event.type == "session.status_idle":
            if event.stop_reason.type != "requires_action":
                break
        elif event.type == "session.status_terminated":
            break
```

If your Console workspace is not named `default`, replace `default` in the trace URL with your workspace slug.

## 4. Raw JSON-RPC fallback

Some MCP clients cannot yet attach a hosted MCP server through Managed Agents. They can still call BuyWhere directly over HTTP JSON-RPC:

```bash
curl -sS https://api.buywhere.ai/mcp \
  -H "content-type: application/json" \
  -H "x-api-key: $BUYWHERE_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "search_products",
      "arguments": {
        "q": "Sony WH-1000XM5",
        "deliver_to": "SG",
        "country_code": "SG",
        "limit": 5
      }
    }
  }'
```

The response is a JSON-RPC envelope. The first content block contains JSON text with the product results.

## Tool choice guide

| User intent | BuyWhere MCP tool | Required buyer-safe fields |
| --- | --- | --- |
| "Find options for X" | `search_products` or `search_products_v2` | `q`, `deliver_to`, optional `country_code` |
| "Where is X cheapest?" | `find_best_price` or `find_best_price_v2` | `product_name` or `q`, `deliver_to` |
| "Compare these products" | `compare_products` or `compare_products_v2` | product identifiers, `deliver_to` |
| "Show deals" | `get_deals` or `get_deals_v2` | `deliver_to`, optional category or country filter |
| "Show product details" | `get_product` or `get_product_v2` | product identifier, optional `deliver_to` |

Use the v2 tools when your client supports them because they enforce `deliver_to` more strictly for shopper-facing calls.

## Production notes

- Retry a transient MCP `-32603` response once, then use the matching REST endpoint on `https://api.buywhere.ai/v1/` rather than telling the shopper no results exist.
- Keep API keys out of agent messages and code repositories.
- Prefer the hosted MCP endpoint for tools that support remote MCP; use `npx -y @buywhere/mcp-server` only when your client requires a local server process.
- Do not report a product as best for the user unless the request included `deliver_to` or the user explicitly said shipping does not matter.

## Next links

- BuyWhere MCP tools cheatsheet: `/blog/buywhere-mcp-tools-cheatsheet`
- Building production MCP servers: `/blog/building-production-mcp-servers`
- BuyWhere API keys: `/api-keys`
