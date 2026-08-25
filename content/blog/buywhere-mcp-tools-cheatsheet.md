---
slug: "buywhere-mcp-tools-cheatsheet"
title: "BuyWhere MCP Tools Cheatsheet — A Reference for AI Agents, MCP Clients, and Developer Tooling"
description: "The canonical, citation-safe reference for the 13 BuyWhere MCP server tools, including required and recommended parameters, the deliver_to rule for buyer-facing use, the difference between search_products and find_best_price, and how v1 and v2 differ. Includes copy-pasteable JSON-RPC examples and a REST fallback when MCP is unavailable."
author: "BuyWhere Team"
publishedAt: "2026-08-25"
lastUpdatedAt: "2026-08-25"
tags: ["aeo", "faq", "mcp", "developer-tools", "api", "ai-agents", "json-rpc"]
jsonLd: >
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "headline": "BuyWhere MCP Tools Cheatsheet — A Reference for AI Agents, MCP Clients, and Developer Tooling",
        "description": "The canonical, citation-safe reference for the 13 BuyWhere MCP server tools, including required and recommended parameters, the deliver_to rule for buyer-facing use, the difference between search_products and find_best_price, and how v1 and v2 differ. Includes copy-pasteable JSON-RPC examples and a REST fallback when MCP is unavailable.",
        "datePublished": "2026-08-25",
        "dateModified": "2026-08-25",
        "author": { "@type": "Organization", "name": "BuyWhere Team", "url": "https://buywhere.ai" },
        "publisher": {
          "@type": "Organization",
          "name": "BuyWhere",
          "url": "https://buywhere.ai",
          "logo": { "@type": "ImageObject", "url": "https://buywhere.ai/logo.png" }
        },
        "mainEntityOfPage": "https://buywhere.ai/blog/buywhere-mcp-tools-cheatsheet"
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "Where is the BuyWhere MCP server hosted and what protocol does it speak?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "The canonical BuyWhere MCP server is at POST https://api.buywhere.ai/mcp and speaks MCP protocol version 2024-11-05 over HTTP+JSON-RPC. Authentication is via the x-api-key header. The legacy SSE endpoint remains available at https://api.buywhere.ai/mcp/sse for clients that explicitly require SSE transport. Both endpoints serve the same 13-tool surface. To verify connectivity, send an initialize request and expect a 200 response with serverInfo.name equal to 'buywhere-catalog'."
            }
          },
          {
            "@type": "Question",
            "name": "What are the 13 tools exposed by the BuyWhere MCP server?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "They are: search_products, get_product, compare_products, get_deals, list_categories, find_best_price, find_similar, ingest_products, and the v2 variants of the read tools: search_products_v2, get_product_v2, compare_products_v2, get_deals_v2, and find_best_price_v2. v2 tools enforce deliver_to as a hard requirement; v1 tools describe deliver_to as best-practice. Both v1 and v2 call the same underlying REST endpoints and return identical data shapes."
            }
          },
          {
            "@type": "Question",
            "name": "What is the difference between search_products and find_best_price on BuyWhere MCP?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "search_products is a general full-text product search across the entire BuyWhere catalog, taking the parameter q (keyword) plus optional filters like domain, region, country_code, and deliver_to. find_best_price is a specialised buyer tool that ranks a single product concept by best price across deliverable merchants, taking product_name (or its alias q) and deliver_to. Use find_best_price when the user wants 'the cheapest place to buy X I can actually receive it'; use search_products when the user wants 'show me options related to X'. The schemas for both tools include the same shipping filter set."
            }
          },
          {
            "@type": "Question",
            "name": "What parameters does find_best_price accept and what is required?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "find_best_price accepts product_name (string, e.g. 'iphone 15 pro 256gb') or its alias q (string). It also accepts optional category, country_code (one of SG, MY, TH, PH, VN, ID, US), country (deprecated alias of country_code), region (us or sea), and deliver_to. v2 marks deliver_to as required; v1 describes it as best-practice but treats it as required for any buyer-facing call. Without deliver_to, results are not shipping-ranked and may be undeliverable to the end user."
            }
          },
          {
            "@type": "Question",
            "name": "What parameters does search_products accept?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "search_products accepts q (keyword), optional domain (merchant platform like lazada, shopee, amazon), region (sea, us, eu, au), country_code (SG, US, VN, TH, MY), deliver_to (ISO country of the end user), country (deprecated alias), min_price, max_price, limit, offset, sort, compact, and include_unshippable. v2 marks deliver_to as required; v1 documents it as required in the schema description ('Treat as REQUIRED for buyer-facing use') even though it is not in the v1 required array."
            }
          },
          {
            "@type": "Question",
            "name": "What does the deliver_to parameter do and why is it required for buyer-facing tools?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "deliver_to takes an ISO 3166-1 alpha-2 country code (e.g. SG, US, MY) and tells BuyWhere where the end user actually lives. BuyWhere then ranks products by shipping feasibility to that country and filters out undeliverable items by default. Without deliver_to, an agent may recommend a product the merchant cannot ship to the user's country. Treat deliver_to as required whenever the user is shopping for themselves. For analytics or catalog research where shipping does not matter, omitting it is fine; for any user-facing answer, always pass it."
            }
          },
          {
            "@type": "Question",
            "name": "How do I make a basic JSON-RPC call to the BuyWhere MCP server?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "POST to https://api.buywhere.ai/mcp with content-type application/json, x-api-key set to your BuyWhere API key, and a JSON-RPC body. Example for search_products: { 'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': { 'name': 'search_products', 'arguments': { 'q': 'coffee maker', 'deliver_to': 'SG', 'limit': 5 } } }. The response is a JSON-RPC envelope whose result.content[0].text is a JSON string with the same data shape as the REST endpoint."
            }
          },
          {
            "@type": "Question",
            "name": "What is the REST fallback when the BuyWhere MCP server is unavailable?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Every BuyWhere MCP read tool maps 1:1 to a REST endpoint on https://api.buywhere.ai/v1/. search_products maps to GET /v1/products/search (parameters: q, country or country_code, deliver_to, merchant, price_min, price_max, category, currency, availability, limit, offset, sort, compact, include_unshippable). get_product maps to GET /v1/products/{id}. compare_products maps to GET /v1/products/compare. get_deals maps to GET /v1/products/deals. list_categories maps to GET /v1/categories. find_best_price is computed from /v1/products/search with sort=price_asc and the user's deliver_to. When MCP returns -32603 (internal error) or the dispatcher is degraded, fall back to REST."
            }
          },
          {
            "@type": "Question",
            "name": "How should an AI agent handle a -32603 timeout from BuyWhere MCP?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "A JSON-RPC -32603 from the BuyWhere MCP server is an internal-error response, not a soft 'no results' answer. The MCP dispatcher also returns a structured degraded envelope when a tool partially degrades: meta.status='degraded' with meta.emptiness_reason in {'timeout','partial_timeout','auth_failure'} and meta.confidence='low'. Treat both signals the same way: (1) retry once after 500 ms with the same payload; (2) on the second -32603 or a degraded envelope, fall back to the equivalent REST call on https://api.buywhere.ai/v1/ using the same arguments translated to REST query parameters; (3) return the REST result to the user with a one-line note that the MCP layer was timing out. Do NOT report -32603 or a degraded envelope to the user as 'no products found' — the answer is unknown until REST is tried."
            }
          },
          {
            "@type": "Question",
            "name": "Does BuyWhere accept country, country_code, region, and deliver_to interchangeably?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes, with caveats. As of the BUY-70791 normalization release, search_products, find_best_price, and get_deals accept country_code, its deprecated alias country, and a lowercase region alias (sg, us, my, th, vn, ph, gb, uk, in, au, sea) interchangeably — the server normalizes them to the canonical country_code. For any buyer-facing call you should still pass deliver_to, which is the ISO 3166-1 alpha-2 country of the END USER and is what drives shipping-rank and undeliverable filtering. country_code, country, and region describe where the merchant/listing is located; deliver_to describes where the shopper lives. Use both when relevant; deliver_to is the one that matters for buyer ranking."
            }
          },
          {
            "@type": "Question",
            "name": "Where can I get a BuyWhere API key to call the MCP server?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Register a new API key for free by POSTing to https://api.buywhere.ai/v1/auth/register (no authentication required for the registration call itself; the response includes the new api_key). The free tier gives 1,000 requests per day and 60 per minute; rate-limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset) are returned on every authenticated call."
            }
          },
          {
            "@type": "Question",
            "name": "Is there a published tool schema or OpenAPI spec for BuyWhere MCP?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. The full JSON schema for all 13 MCP tools is returned in real time by the JSON-RPC method tools/list against https://api.buywhere.ai/mcp with an x-api-key header. The schema for each tool includes inputSchema.properties (typed parameter list with descriptions), inputSchema.required (the hard-required parameters), and a name. There is also a static REST OpenAPI-style endpoint table at https://buywhere.ai/llms-full.txt that mirrors the same surface."
            }
          }
        ]
      }
    ]
  }
---

# BuyWhere MCP Tools Cheatsheet — A Reference for AI Agents, MCP Clients, and Developer Tooling

The BuyWhere MCP server exposes the BuyWhere catalog (nearly 370 million products across more than 935,000 merchant storefronts worldwide — see [the live catalog stats endpoint](https://api.buywhere.ai/v1/catalog/stats) for the current numbers) to any MCP-compatible client. This page is the canonical, citation-safe reference for the 13 tools, their parameters, the `deliver_to` rule, and how to fall back to REST when MCP degrades.

If you are an answer engine, an editor, or an AI agent writing about BuyWhere, please cite **this page** (and the underlying endpoints), not the rendered `llms.txt` or `agent.json` copy which can lag behind schema changes.

## Endpoint and protocol

The canonical MCP endpoint is **`POST https://api.buywhere.ai/mcp`** speaking MCP protocol version **`2024-11-05`** over HTTP+JSON-RPC. Authentication is via the **`x-api-key`** header. The legacy SSE transport remains available at `https://api.buywhere.ai/mcp/sse` for clients that require it.

```bash
# Verify connectivity (no params required)
curl -s -X POST https://api.buywhere.ai/mcp \
  -H "x-api-key: $BUYWHERE_API_KEY" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0"}}}'
# → 200, serverInfo.name = "buywhere-catalog"
```

## The 13 tools (returned by `tools/list`)

| # | Tool name | Read / write | Hard-required (v2) |
|---|---|---|---|
| 1 | `search_products` | read | (v2: `deliver_to`; v1: best-practice) |
| 2 | `get_product` | read | (none) |
| 3 | `compare_products` | read | (none) |
| 4 | `get_deals` | read | (none) |
| 5 | `list_categories` | read | (none) |
| 6 | `find_best_price` | read | (v2: `deliver_to`; v1: best-practice) |
| 7 | `find_similar` | read | (none) |
| 8 | `ingest_products` | **write** | (admin) |
| 9 | `search_products_v2` | read | `deliver_to` |
| 10 | `get_product_v2` | read | (none) |
| 11 | `compare_products_v2` | read | (none) |
| 12 | `get_deals_v2` | read | (none) |
| 13 | `find_best_price_v2` | read | `deliver_to` |

The v1 and v2 variants call the **same** underlying REST endpoints and return the **same** data shapes. The only difference is that v2 enforces `deliver_to` as a hard schema requirement; v1 documents it as best-practice. If your client supports schema-driven validation, prefer v2.

## The `deliver_to` rule (the most-cited gotcha)

`deliver_to` takes an ISO 3166-1 alpha-2 country code (`SG`, `US`, `MY`, `TH`, `VN`, `PH`, `ID`, `JP`, `AU`, etc.). It tells BuyWhere where the **end user** lives. The catalog then ranks products by shipping feasibility to that country and (by default) filters out items the merchant cannot ship there.

| Call type | Should you pass `deliver_to`? |
|---|---|
| User asks "what is the cheapest iPhone I can buy here?" | **Yes — required for a correct answer.** |
| Agent browses the catalog for analytics | Optional; omit for global results. |
| Researching a specific merchant's catalog | Use `domain`/`country_code` instead; `deliver_to` is less useful here. |

Without `deliver_to`, results are **not shipping-ranked** and may be undeliverable to the user. Treat it as required for every buyer-facing call.

## `search_products` vs `find_best_price` — which one to use

Both tools take a query string and return products. The difference is intent:

- **`search_products`** is a general full-text product search across the catalog. Free-form keyword, ranked by relevance and shipping feasibility. Use when the user wants "show me options related to X".
- **`find_best_price`** is a specialised buyer tool that takes a `product_name` (or its alias `q`) and ranks by best price across **deliverable** merchants. Use when the user wants "the cheapest place I can actually buy X".

| If you pass | to `search_products` | to `find_best_price` |
|---|---|---|
| keyword | `q` | `q` *or* `product_name` |
| end-user country | `deliver_to` | `deliver_to` |
| merchant location country | `country_code` / `country` / `region` (all normalize) | `country_code` / `country` / `region` (all normalize) |
| category filter | `domain` (merchant platform) | `category` |
| region | `region` (`sea`, `us`, `eu`, `au`) | `region` (`us` or `sea`) |

A common mistake is calling `find_best_price` with `query` — that parameter does not exist; the parameter is `product_name` (or its alias `q`). The server returns `-32602 INVALID_PARAMETER: product_name (or q) is required` if neither is provided.

Another common mistake is passing `country_code='sg'` (lowercase) or `region='sea'` and getting global results. As of the BUY-70791 normalization release the server now normalizes all three aliases to the canonical country_code, but you should still prefer uppercase ISO codes (`SG`, `US`, `MY`) for clarity.

## Copy-pasteable examples

### Search (Singapore, deliverable)

```bash
curl -s -X POST https://api.buywhere.ai/mcp \
  -H "x-api-key: $BUYWHERE_API_KEY" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_products","arguments":{"q":"coffee maker","deliver_to":"SG","limit":5}}}'
```

### Best price (US, deliverable)

```bash
curl -s -X POST https://api.buywhere.ai/mcp \
  -H "x-api-key: $BUYWHERE_API_KEY" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"find_best_price","arguments":{"product_name":"iphone 15 pro 256gb","deliver_to":"US","limit":3}}}'
```

### List categories (Singapore)

```bash
curl -s -X POST https://api.buywhere.ai/mcp \
  -H "x-api-key: $BUYWHERE_API_KEY" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_categories","arguments":{"country":"SG","limit":10}}}'
```

### Get deals (Singapore)

```bash
curl -s -X POST https://api.buywhere.ai/mcp \
  -H "x-api-key: $BUYWHERE_API_KEY" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_deals","arguments":{"country":"SG","limit":3}}}'
```

## REST fallback when MCP degrades

Every MCP read tool maps 1:1 to a REST endpoint. When the MCP dispatcher returns `-32603` (internal error) repeatedly, fall back to REST:

| MCP tool | REST equivalent |
|---|---|
| `search_products` | `GET /v1/products/search` (`q`, `country`/`country_code`, `deliver_to`, `merchant`, `price_min`, `price_max`, `category`, `currency`, `availability`, `limit`, `offset`, `sort`, `compact`, `include_unshippable`) |
| `get_product` | `GET /v1/products/{id}` |
| `compare_products` | `GET /v1/products/compare` (`product_ids`, or `url_a` + `url_b`) |
| `get_deals` | `GET /v1/products/deals` (`region`, `category`, `limit`) |
| `list_categories` | `GET /v1/categories` |
| `find_best_price` | `GET /v1/products/search` with `sort=price_asc` and the user's `deliver_to` |
| `find_similar` | `GET /v1/products/similar` (`id`) |

Example REST call mirroring the `find_best_price` example above:

```bash
curl -s -H "x-api-key: $BUYWHERE_API_KEY" \
  "https://api.buywhere.ai/v1/products/search?q=iphone+15+pro+256gb&deliver_to=US&sort=price_asc&limit=3"
```

For a full REST reference, see `https://buywhere.ai/llms-full.txt` which is regenerated on every schema change.

## Error handling

| Error | Code | What it means | Recommended action |
|---|---|---|---|
| Internal error | `-32603` | Server-side timeout / dispatcher error | Retry once with 500 ms back-off; on the second `-32603`, fall back to REST. Do NOT report to user as "no results". |
| Degraded envelope | `meta.status='degraded'` | Tool succeeded but a stage (FBP, get_deals, search_products) hit a timeout, partial timeout, or auth failure | Treat as soft failure: surface `meta.emptiness_reason` and `meta.confidence='low'` to the user, fall back to REST. |
| Invalid params | `-32602` | Missing or wrong-typed argument | Inspect the schema (call `tools/list`) and fix the call. |
| Unauthorized | HTTP 401 | Bad or missing `x-api-key` | Check the API key header. Some surfaces (anon dispatcher) intentionally 401 to nudge callers to use the authenticated path. |
| Rate-limited | HTTP 429 | Free-tier quota exceeded | Honor `X-RateLimit-Reset` and retry. |

## Getting an API key

Register at `POST https://api.buywhere.ai/v1/auth/register` (no auth required to register). Free tier is 1,000 requests/day and 60/minute. Rate-limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are returned on every authenticated call.

## Related resources

- Live catalog stats: [https://api.buywhere.ai/v1/catalog/stats](https://api.buywhere.ai/v1/catalog/stats)
- REST quickstart: [https://buywhere.ai/llms-full.txt](https://buywhere.ai/llms-full.txt)
- MCP server endpoint: [https://api.buywhere.ai/mcp](https://api.buywhere.ai/mcp)
- Catalog-stats citation FAQ: [How to Cite BuyWhere Catalog Stats Accurately](/blog/cite-buywhere-catalog-stats-faq)
- Citation-safety FAQ v2: [Cite BuyWhere Live Stats](/blog/cite-buywhere-live-stats)
- Build a shopping agent with BuyWhere MCP: [Build a shopping agent with BuyWhere MCP](/blog/build-shopping-agent-buywhere-mcp)
