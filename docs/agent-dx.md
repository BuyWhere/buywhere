---
title: "Agent Developer Experience"
description: "How to integrate BuyWhere MCP into AI agents. v2 quickstart, v1 vs v2 comparison, and migration guide."
public: true
---

# Agent Developer Experience

BuyWhere exposes its product catalog as an MCP server so AI agents can search, compare, and recommend products. This guide is for the agent-builder: it covers the v2 surface (the recommended path), explains how v1 and v2 differ, and walks through migration.

> **Status (2026-08-19):** v2 is the recommended path. The v2 tool surface (`search_products_v2`, `find_best_price_v2`, `get_deals_v2`) is **not yet live** — Rex (CTO) is shipping the wire in the upcoming P2.7 release. The contracts below are stable; small field-name polish is possible before launch. This page will be marked "live" once v2 reaches production.

## Why v2

Today (v1), `deliver_to` is an **optional** parameter on the search tools. Telemetry shows ~94% of MCP calls omit it. Without `deliver_to`, results rank globally and ship many products the end user can't actually receive. Agents that want a "can my user buy this?" signal today have to call a separate `verify_deliverable` endpoint (and most don't).

v2 makes `deliver_to` **required** on the search, best-price, and deals tools. The response shape is unchanged. Agents that pass `deliver_to` get deliverable-first ranking on the v2 surface; agents on v1 see no change.

## v2 quickstart (when live)

### Required parameter: `deliver_to`

`deliver_to` is a two-letter ISO 3166-1 alpha-2 country code (e.g. `SG`, `US`, `MY`, `TH`, `ID`, `VN`, `PH`, `GB`, `AU`, `IN`). It is **required** on v2 search/best-price/deals. There is no default — a call without it is rejected with `MISSING_REQUIRED_FIELD` (see [errors.md](errors.md)).

### Tool: `search_products_v2`

```json
{
  "name": "search_products_v2",
  "inputSchema": {
    "type": "object",
    "required": ["query", "deliver_to"],
    "properties": {
      "query": { "type": "string", "description": "Keyword search query" },
      "deliver_to": { "type": "string", "description": "End-user ISO 3166-1 alpha-2 country code" },
      "category": { "type": "string", "description": "Category slug filter" },
      "min_price": { "type": "number", "description": "Minimum price" },
      "max_price": { "type": "number", "description": "Maximum price" },
      "source": { "type": "string", "description": "Merchant platform filter" },
      "include_unshippable": { "type": "boolean", "default": true, "description": "Include results that cannot ship to deliver_to" },
      "limit": { "type": "integer", "default": 10, "description": "Max results (1-50)" }
    }
  }
}
```

Every result carries an availability label. The `availability` field is one of:

- `in_stock` — currently in stock and shippable to `deliver_to`.
- `out_of_stock` — not currently in stock.
- `preorder` — available for preorder.
- `discontinued` — no longer sold.
- `unshippable` — in stock, but the merchant does not ship to `deliver_to`. Only appears when `include_unshippable: true` (the v2 default).

### Tool: `find_best_price_v2`

```json
{
  "name": "find_best_price_v2",
  "inputSchema": {
    "type": "object",
    "required": ["product_name", "deliver_to"],
    "properties": {
      "product_name": { "type": "string", "description": "Product name to search for" },
      "deliver_to": { "type": "string", "description": "End-user ISO 3166-1 alpha-2 country code" },
      "category": { "type": "string", "description": "Category slug filter" }
    }
  }
}
```

Returns the single cheapest listing that ships to `deliver_to`. If you need the cheapest globally, set `include_unshippable: true` and inspect `availability`.

### Tool: `get_deals_v2`

```json
{
  "name": "get_deals_v2",
  "inputSchema": {
    "type": "object",
    "required": ["deliver_to"],
    "properties": {
      "deliver_to": { "type": "string", "description": "End-user ISO 3166-1 alpha-2 country code" },
      "category": { "type": "string", "description": "Category slug filter" },
      "min_discount_pct": { "type": "number", "default": 10, "description": "Minimum discount percentage" },
      "include_unshippable": { "type": "boolean", "default": true },
      "limit": { "type": "integer", "default": 20, "description": "Max results" }
    }
  }
}
```

### Minimum-viable agent call

```python
import httpx

API_KEY = "bw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

resp = httpx.post(
    "https://api.buywhere.ai/mcp",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "search_products_v2",
            "arguments": {
                "query": "wireless headphones",
                "deliver_to": "SG",   # required
                "limit": 5,
            },
        },
    },
    timeout=10,
)
data = resp.json()

for product in data["result"]["results"]:
    if product["availability"] == "in_stock":
        print(f"{product['title']} — {product['price']['currency']} {product['price']['amount']}")
```

`deliver_to` should be sourced from the end user's profile, account settings, or a clear, one-time user confirmation. Don't guess.

## v1 vs v2 comparison

| Concern | v1 (`search_products`, `find_best_price`, `get_deals`) | v2 (`*_v2`) |
|---|---|---|
| `deliver_to` | Optional | **Required** |
| Default ranking | Global | Deliverable-first to `deliver_to` |
| Empty results | No machine-readable reason | `meta.emptiness_reason` (P2.6) |
| `include_unshippable` | Default `false` | Default `true` |
| `verify_deliverable` follow-up call | Often needed | Not needed — `availability` is per-row |
| Response shape | Identical to v2 | Identical to v1 |
| Auth, rate limit, billing | Same | Same |
| Sunset | TBD (Phase D, 2026-Q1 if v2 adoption ≥80%) | Live |

**TL;DR:** v1 keeps working. v2 returns better-ranked, more honest results by forcing you to tell BuyWhere where the user actually lives.

## Migration guide (v1 → v2)

The migration is a one-liner per call site: drop the `_v2` suffix and add `deliver_to`.

### 1. Identify v1 call sites

```bash
# In your agent's source
grep -rE "search_products|find_best_price|get_deals" src/ --include="*.ts" --include="*.py" --include="*.js"
```

These are your v1 call sites. (Other tools — `get_product`, `compare_products`, `list_categories` — are unchanged in v2.)

### 2. Add `deliver_to` to your context

`deliver_to` is per-call, not per-session. Best places to source it:

- The end-user's profile / account country.
- The locale of the conversation.
- An explicit user prompt: "Which country are you shopping from?"

If you cannot determine it, ask. Do not default to a market and hope for the best — that recreates the v1 problem.

### 3. Switch the tool name and add the param

```diff
- "name": "search_products",
- "arguments": { "q": "wireless headphones", "limit": 5 }
+ "name": "search_products_v2",
+ "arguments": {
+   "query": "wireless headphones",
+   "deliver_to": "SG",
+   "limit": 5
+ }
```

Three notes on the diff above:

- The query field name **changes** from `q` (v1) to `query` (v2). This is a breaking rename to match the v2 tool surface. Update your call sites.
- The market-derivation params from v1 (`country_code`, `region`, `country`, `currency`) are **removed** on v2. `deliver_to` is the only market input; prices and currency are inferred from it.
- All other params (`category`, `min_price`, `max_price`, `source`, `limit`) carry over with the same meaning.

### 4. Stop calling `verify_deliverable`

If your v1 flow was: `search_products` → for each result, `verify_deliverable` → filter, drop the second step. Each v2 result has `availability` inline.

If you need the v1 `verify_deliverable` tool (e.g. for a product ID you already have), it still exists and is unchanged.

### 5. Run both surfaces for one rollout cycle (optional but recommended)

If you can't flip every call site at once, run v1 and v2 in parallel for a single release and diff the `availability` distributions — it surfaces the v1 "looks fine but unshippable" holes that motivated v2.

```python
def search_both(query, deliver_to):
    return {
        "v1": call("search_products", {"q": query, "limit": 20}),
        "v2": call("search_products_v2", {"query": query, "deliver_to": deliver_to, "limit": 20}),
    }
```

## Companion guides

- [getting-started.md](getting-started.md) — auth, registration, first call.
- [errors.md](errors.md) — full error code reference. v2 adds `MISSING_REQUIRED_FIELD` for `deliver_to`.
- [api-reference/search.md](api-reference/search.md) — REST equivalent of `search_products` (still v1; v2 HTTP endpoint follows in a later spec).
- [guides/mcp-integration.md](guides/mcp-integration.md) — wiring BuyWhere MCP into Mastra, Claude Desktop, and other agent frameworks.
