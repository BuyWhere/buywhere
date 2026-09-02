const markdown = `# BuyWhere Agent DX — v2 Wire Reference

This document is the primary developer-facing reference for agents calling BuyWhere
through the MCP JSON-RPC wire. It is **v2-first**: every section leads with the
\`<tool>_v2\` tool surface that requires \`deliver_to\`. The v1 tools remain callable
through **2026-12-31Z** and are documented in a collapsible "v1 (deprecated)" section
at the bottom. After that date, v1 tools return HTTP 410 Gone.

## v2 wire version

\`\`\`
v2.0.0-2026-09-15
\`\`\`

The v2 wire is exposed at \`POST https://api.buywhere.ai/mcp\` via JSON-RPC 2.0.
Both \`streamable-http\` and the legacy \`sse\` transports are supported. The MCP
server-card at \`https://buywhere.ai/.well-known/mcp/server-card.json\` is the
authoritative machine-readable copy of these tools.

## Why \`deliver_to\` is now required

In v1, \`deliver_to\` was optional. In practice, 94% of agent calls omitted it,
forcing the catalog to scan every market (SG, MY, ID, TH, VN, US) and either
time out or return rankings that were not useful for the buyer's actual location.
The v2 wire makes \`deliver_to\` **mandatory** on every buyer-context tool so the
catalog can scope the search, return local-availability labels, and emit a
\`shopping_job_id\` that lets the agent resume the purchase funnel on the
merchant site. Agents that omit \`deliver_to\` on a v2 tool receive
\`-32602 INVALID_ARGUMENT\` so the failure is loud, not silent.

\`\`\`
deliver_to: ISO 3166-1 alpha-2 country code (e.g. "SG", "US", "MY", "TH", "VN", "ID")
\`\`\`

## Tool selection — which v2 tool fits which intent

| User intent                                | v2 tool                  |
|--------------------------------------------|--------------------------|
| "find X", "search for X", "show X"         | \`search_products_v2\`   |
| "cheapest X", "best price for X"           | \`find_best_price_v2\`   |
| "deals on X", "discounts on X"             | \`get_deals_v2\`         |
| "compare A vs B", "A vs B vs C"            | \`compare_products_v2\`  |
| "details on product <id>", "tell me more"  | \`get_product_v2\`       |

\`list_categories\`, \`find_similar\`, and \`ingest_products\` remain v1-only — they
are not buyer-context tools and do not require \`deliver_to\`.

---

## search_products_v2

Search the catalog by keyword. Returns ranked, deliverable-first results with
schema.org/Product entities.

**Required:** \`q\`, \`deliver_to\`

**Request body:**

\`\`\`json
{
  "q": "wireless headphones",
  "deliver_to": "SG",
  "limit": 10,
  "category": "Headphones",
  "min_price": 50,
  "max_price": 800,
  "sort": "best_value"
}
\`\`\`

**Response shape:**

\`\`\`json
{
  "data": [
    {
      "id": "bw_sg_12345",
      "title": "Sony WH-1000XM5",
      "price": 429.0,
      "currency": "SGD",
      "domain": "hifisolutions.sg",
      "url": "https://hifisolutions.sg/products/sony-wh-1000xm5",
      "buywhere_score": 0.92,
      "availability": "in_stock",
      "deliver_to": "SG"
    }
  ],
  "meta": {
    "total": 124,
    "limit": 10,
    "offset": 0,
    "shopping_job_id": "9f3a4b1e-7c2d-4a8e-b651-2c0a4f7b9d3e"
  }
}
\`\`\`

## find_best_price_v2

Find the single cheapest deliverable listing for a product across covered
storefronts. Returns a \`shopping_job_id\` and a resolved \`outbound_url\` your
agent can hand back to the buyer.

**Required:** \`q\`, \`deliver_to\`

**Request body:**

\`\`\`json
{
  "q": "iphone 17 pro 256gb",
  "deliver_to": "SG",
  "category": "Smartphones"
}
\`\`\`

**Response shape:**

\`\`\`json
{
  "data": {
    "id": "bw_sg_98765",
    "title": "Apple iPhone 17 Pro 256GB",
    "lowPrice": 1599.0,
    "priceCurrency": "SGD",
    "offerCount": 6,
    "merchant": "Best Denki",
    "outbound_url": "https://api.buywhere.ai/v2/outbound/9f3a4b1e-7c2d-4a8e-b651-2c0a4f7b9d3e?to=best-denki-sg"
  },
  "shopping_job_id": "9f3a4b1e-7c2d-4a8e-b651-2c0a4f7b9d3e",
  "deliver_to": "SG"
}
\`\`\`

## get_deals_v2

Discounted products sorted by discount percentage. Returns the same
\`shopping_job_id\` envelope so the agent can hand the user a single
\`outbound_url\` to the deal.

**Required:** \`deliver_to\`

**Request body:**

\`\`\`json
{
  "deliver_to": "US",
  "min_discount_pct": 20,
  "category": "Laptops",
  "limit": 20
}
\`\`\`

**Response shape:**

\`\`\`json
{
  "data": [
    {
      "id": "bw_us_55432",
      "title": "Lenovo IdeaPad 5 14\\"",
      "price": 549.0,
      "originalPrice": 799.0,
      "discountPercentage": 31.3,
      "priceCurrency": "USD",
      "availability": "in_stock",
      "outbound_url": "https://api.buywhere.ai/v2/outbound/4b1e9f3a-2c0a-4f7b-9d3e-7c2d8e651a4f?to=lenovo-us"
    }
  ],
  "shopping_job_id": "4b1e9f3a-2c0a-4f7b-9d3e-7c2d8e651a4f",
  "deliver_to": "US"
}
\`\`\`

## compare_products_v2

Compare 2 to 10 products side-by-side across merchants, prices, attributes,
and availability. Each comparison row carries the buyer's \`deliver_to\`
availability state.

**Required:** \`ids\`, \`deliver_to\`

**Request body:**

\`\`\`json
{
  "ids": ["bw_sg_12345", "bw_sg_67890", "bw_sg_24680"],
  "deliver_to": "SG"
}
\`\`\`

**Response shape:**

\`\`\`json
{
  "data": [
    {
      "id": "bw_sg_12345",
      "title": "Sony WH-1000XM5",
      "price": 429.0,
      "currency": "SGD",
      "availability": "in_stock",
      "buywhere_score": 0.92,
      "deliver_to": "SG"
    }
  ],
  "shopping_job_id": "8a2c4d6e-1f3b-4a5d-9c7e-2b8d0f4a6c8e",
  "deliver_to": "SG"
}
\`\`\`

## get_product_v2

Retrieve full details for a specific product. Adds an \`outbound_url\` resolver
so the agent can return a direct handoff to the merchant.

**Required:** \`id\`, \`deliver_to\`

**Request body:**

\`\`\`json
{
  "id": "bw_sg_12345",
  "deliver_to": "SG"
}
\`\`\`

**Response shape:**

\`\`\`json
{
  "data": {
    "id": "bw_sg_12345",
    "title": "Sony WH-1000XM5",
    "description": "Industry-leading noise cancellation...",
    "price": 429.0,
    "currency": "SGD",
    "availability": "in_stock",
    "merchant": "Hifi Solutions",
    "outbound_url": "https://api.buywhere.ai/v2/outbound/2c8d0f4a-6a8c-4e2b-9d4f-1a3c5e7b9d2f?to=hifisolutions-sg",
    "structured_specs": { /* ... */ }
  },
  "shopping_job_id": "2c8d0f4a-6a8c-4e2b-9d4f-1a3c5e7b9d2f",
  "deliver_to": "SG"
}
\`\`\`

---

## Sunset clock

| Date          | Event                                                              |
|---------------|--------------------------------------------------------------------|
| 2026-09-15Z   | v2 wire live; v2 tools exposed on \`/mcp tools/list\` with REQUIRED \`deliver_to\`. |
| 2026-10-01Z   | v1 tools deprecated; server-card prepends \`[DEPRECATED — use v2]\` to each v1 description. |
| 2026-12-31Z   | v1 tools return HTTP 410 Gone with migration notice.              |

## v1 (deprecated)

> Collapsed for reference. The v1 tools remain callable until **2026-12-31Z**,
> but new agent work should target the v2 wire above. The v1 tools match v2
> request bodies **except \`deliver_to\` is optional** and the response does
> not include \`shopping_job_id\` or \`outbound_url\`.

<details>
<summary>v1 tool reference (deprecated)</summary>

- \`search_products(query, category, min_price, max_price, source, deliver_to?, limit)\`
- \`get_product(product_id)\`
- \`find_best_price(product_name, category, deliver_to?)\`
- \`get_deals(category, min_discount_pct=10, deliver_to?, limit=20)\`
- \`compare_products(ids, deliver_to?)\` — \`ids\` is a CSV string in v1, an array of length 2-10 in v2.
- \`list_categories\`, \`find_similar\`, \`ingest_products\` — unchanged in v2.

v1 wire version: \`1.0.0\`. Server-card version remains \`1.0.0\`; the v2 marker
lives in the top-level \`x-buywhere-v2\` extension field.

</details>

## Empty-result envelope (\`meta.emptiness_reason\`)

When a v2 tool returns \`200 OK\` with zero products, the response includes
\`meta.emptiness_reason\` so the agent can distinguish "no catalog data" from
"query mismatch" from "API degraded." This field appears **only** when the
result array is empty; non-empty responses never carry it.

| \`emptiness_reason\` | What it means | What your agent should do |
|---|---|---|
| \`no_data\` | Region has zero products indexed. | Treat as authoritative; no retry. |
| \`no_match\` | Region has products, but query/filters excluded all of them. | Widen query or drop filters; do not retry the same query. |
| \`api_error\` | Downstream error caused the engine to fall back to empty. | Retry once with a short backoff (≤2s); surface as ambiguous if still empty. |
| \`quota\` | Rate-limit guardrail tripped. | Wait for the rate-limit window; do not retry-storm. |
| \`region_unsupported\` | Country code is not in the supported set. | Re-issue with a supported region. |
| \`category_unsupported\` | Category slug is unknown or in transition. | Drop category or consult \`/v1/categories\`. |
| \`deliver_to_missing\` | You omitted \`deliver_to\`/\`country_code\`, but the catalog has matches elsewhere. | Re-issue with \`deliver_to\` set to the buyer's country. |
| \`invalid_deliver_to\` | \`deliver_to\` is not a supported ISO code (MCP v2 only). | Use a supported code from the \`hint\` field. |

Every empty result also carries \`meta.confidence\` (\`high\` or \`low\`). When
confidence is \`low\`, the agent should retry once after a short backoff;
otherwise, treat the reason as authoritative.

\`meta.diagnostic\` includes \`engine_status\`, \`indexed_for_region\`,
\`category_recognized\`, \`rate_limit_remaining\`, and \`deliver_to_present\`. See the
full reference in [\`/docs/errors#empty-result-envelope-metaemptiness_reason\`](/docs/errors#empty-result-envelope-metaemptiness_reason).

## Acceptance contract

The README at \`/agent-dx\` is the canonical copy of this document. The MCP
server-card at \`/.well-known/mcp/server-card.json\` mirrors these descriptions
word-for-word. Changes to either surface MUST be made in lockstep with the
other. Atlas (BUY-72534) verifies live parity on every heartbeat.
`;

export function GET() {
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      Vary: "Accept",
    },
  });
}
