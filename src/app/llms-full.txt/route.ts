export const dynamic = 'force-static';

const llmsFull = `# BuyWhere — Agent-Native Product Catalog API (Full Reference)

> BuyWhere is a product catalog API designed for AI agents and LLM pipelines. It provides semantic product search across 1.5M+ products, normalized pricing data, real-time availability, and cross-border market matching. Based in Singapore, expanding globally.

## Table of Contents

1. Quick Start
2. Authentication
3. Product API Reference
4. Category & Merchant API
5. Comparison API
6. Analytics & Revenue API
7. MCP Server
8. SDKs & Packages
9. Pricing
10. Webhooks & Alerts
11. Rate Limits

---

## 1. Quick Start

\`\`\`bash
# Get an API key: https://buywhere.ai/quickstart

# Search products
curl -X GET "https://api.buywhere.ai/v1/products/search" \\
  -H "Authorization: Bearer bw_live_YOUR_API_KEY" \\
  -G --data-urlencode "q=wireless headphones" --data-urlencode "limit=5"

# Or install the MCP server
npx -y @buywhere/mcp-server
\`\`\`

## 2. Authentication

**API Key (recommended):**
\`\`\`
Authorization: Bearer bw_live_YOUR_API_KEY
\`\`\`
Or use header: \`X-Buywhere-Key: your_api_key\`

**OAuth 2.0:**
\`\`\`
Authorization: Bearer {token}
\`\`\`

**Usage tracking:** All authenticated requests count toward your monthly quota. Unauthenticated requests to /v1/catalog/stats, /v1/demo/search have stricter rate limits.

**Register for an API key:**
\`\`\`bash
curl -X POST "https://api.buywhere.ai/v1/auth/register" \\
  -H "Content-Type: application/json" \\
  -d '{"agent_name": "My Shopping Agent", "use_case": "price comparison"}'
\`\`\`

## 3. Product API Reference

### Search Products
GET https://api.buywhere.ai/v1/products/search

Parameters:
- q (string): Search query (supports natural language)
- domain (string): Filter by domain (e.g. lazada_sg)
- region (string): Region filter
- country_code (string): 2-letter country code
- country (string): Country name
- category (string): Category name
- category_id (integer): Category ID
- category_path (string): Full category path
- brand (string): Brand name
- merchant_id (string): Merchant ID
- availability (string): in_stock or out_of_stock
- min_price (number): Minimum price
- max_price (number): Maximum price
- currency (string): Currency code (SGD, USD, MYR)
- limit (integer): Results per page (max 100)
- offset (integer): Pagination offset
- page (integer): Page number
- fields (string): Comma-separated field list
- sort (string): relevance, price_asc, price_desc, newest, highest_rated, most_reviewed
- compact (boolean): Compact response

Response:
\`\`\`json
{
  "success": true,
  "total": 47,
  "limit": 5,
  "offset": 0,
  "has_more": true,
  "data": [
    {
      "id": 12345,
      "name": "Sony WH-1000XM5 Wireless Headphones",
      "price": 429.00,
      "currency": "SGD",
      "source": "lazada_sg",
      "buy_url": "...",
      "affiliate_url": "...",
      "image_url": "...",
      "is_available": true,
      "rating": 4.8,
      "category": "Electronics > Audio > Headphones",
      "merchant": "Sony Store SG",
      "buywhere_score": 0.92,
      "confidence": 0.95
    }
  ],
  "meta": { "query_info": { "q": "wireless headphones" } }
}
\`\`\`

### Get Product Detail
GET https://api.buywhere.ai/v1/products/{id}
Optional: include_history=true for price history.

### Best Price
GET https://api.buywhere.ai/v1/products/best-price?product_name={name}&country_code={code}
Returns cheapest option across all merchants.

### Get Deals
GET https://api.buywhere.ai/v1/products/deals
Parameters: min_discount, currency, country_code, limit, offset. Sorted by discount percentage.

### Compare Products
GET https://api.buywhere.ai/v1/products/compare?ids=id1,id2,id3
Compare 2-10 products side-by-side with unified schema.

### Similar Products
GET https://api.buywhere.ai/v1/products/{id}/similar?limit=8

### Price History
GET https://api.buywhere.ai/v1/products/{id}/price-history?days=90
Daily aggregated. Options: 30, 90, 180 days.

GET https://api.buywhere.ai/v1/products/{id}/prices?days=90
Raw snapshots (max 90 days).

### Ingest Products (Bulk)
POST https://api.buywhere.ai/v1/products/ingest
Body: array of products with platform, name, price, product_url. Max 500.

### Bulk Upsert (Admin)
POST https://api.buywhere.ai/v1/ingest/products
Body: { source, products[] }. Max 1000.

## 4. Category & Merchant API

### List Categories
GET https://api.buywhere.ai/v1/categories
Top-level categories. Optional: currency.

### Category Detail
GET https://api.buywhere.ai/v1/categories/{slug}
Subcategories + sample products. Params: currency, limit, offset.

### List Merchants
GET https://api.buywhere.ai/v1/merchants
Params: limit, offset, is_active, onboarding_stage, country.

### Merchant Detail
GET https://api.buywhere.ai/v1/merchants/{id}

### Catalog Stats (Public, no auth)
GET https://api.buywhere.ai/v1/catalog/stats

## 5. Comparison API

### Get Comparison Page
GET https://api.buywhere.ai/v1/compare/{slug}
Published SEO page with Schema.org JSON-LD.

### Track Click
POST https://api.buywhere.ai/v1/compare/{slug}/click
Body: { retailer, price, rank }

### Outbound Click Redirect
GET https://api.buywhere.ai/api/click?url={url}&product_id={id}&merchant={name}
302 redirect with affiliate tracking.

### Affiliate Redirect
GET https://api.buywhere.ai/r/{slug}/{productId}
302 via affiliate_links table.

## 6. Analytics & Revenue API

- GET /v1/analytics/overview?days=7 - Daily query counts
- GET /v1/analytics/agents?days=7&limit=10 - Top agents
- GET /v1/analytics/products?days=7&limit=10&agent_only=true - Top products
- GET /v1/analytics/conversions?days=7 - Affiliate conversion rates
- GET /v1/analytics/endpoints?days=7 - Endpoint breakdown
- GET /v1/analytics/geo-scorecard?weeks=4 - GEO performance
- GET /v1/analytics/latency?minutes=60&threshold=500 - p50/p95/p99 (admin)
- GET /v1/revenue/report?days=30 - Commission + coverage

## 7. MCP Server

### Install
\`\`\`bash
npx -y @buywhere/mcp-server
pip install buywhere-mcp
\`\`\`

### Tools
- search_products(q, category, brand, min_price, max_price, country_code, limit)
- get_product(id)
- compare_products(ids) - 2-10 items
- get_deals(min_discount, currency, region, limit)
- list_categories()
- find_best_price(product_name, category, country_code)

### Hosted Endpoint
POST https://api.buywhere.ai/mcp - JSON-RPC 2.0

### Claude Desktop Config
\`\`\`json
{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"]
    }
  }
}
\`\`\`

## 8. SDKs & Packages

- @buywhere/sdk - TypeScript client with search, compare, deals, autocomplete, webhooks
- @buywhere/mcp-server - STDIO MCP server (5 tools)
- @buywhere/openai-tools - OpenAI function-calling definitions
- @buywhere/langchain - 9 LangChain Tool subclasses
- buywhere-openai-python - Python OpenAI tool definitions

\`\`\`typescript
import { BuyWhereClient } from '@buywhere/sdk';
const client = new BuyWhereClient({ apiKey: 'bw_live_...' });
const results = await client.search({ q: 'laptop', limit: 10 });
\`\`\`

## 9. Pricing

- Free: 10 req/min, 1,000 queries/month - $0
- Starter: 60 req/min, 100,000 queries/month - $29/mo
- Growth: 300 req/min, 1,000,000 queries/month - $99/mo
- Scale: 1,000 req/min, unlimited - $499/mo
- Enterprise: Custom

## 10. Webhooks & Alerts

- Price alerts: POST /api/auth/me/alerts { product_id, target_price }
- Webhooks: POST /api/dashboard/alerts { url, events: ["price_change", "back_in_stock"] }

## 11. Rate Limits

- Free: 10 req/min, 1,000/mo
- Starter: 60 req/min, 100,000/mo
- Growth: 300 req/min, 1,000,000/mo
- Scale: 1,000 req/min, unlimited

Rate limit headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset

## Response Format

Success:
\`\`\`json
{ "success": true, "data": {}, "meta": {}, "affiliate_links": [] }
\`\`\`

Error:
\`\`\`json
{ "success": false, "error": { "code": "INVALID_API_KEY", "message": "..." } }
\`\`\`

## A2A

- Agent Card: https://buywhere.ai/.well-known/agent.json
- Task endpoint: POST https://api.buywhere.ai/a2a/tasks

## Discovery

- llms.txt: https://buywhere.ai/llms.txt
- AI Plugin: https://buywhere.ai/.well-known/ai-plugin.json
- MCP Server Card: https://buywhere.ai/.well-known/mcp/server-card.json
- API Catalog: https://buywhere.ai/.well-known/api-catalog
- Agent Card: https://buywhere.ai/.well-known/agent.json
- OpenAPI Spec: https://api.buywhere.ai/openapi.json
- APIs.json: https://buywhere.ai/apis.json

## Contact

- Website: https://buywhere.ai
- API Console: https://buywhere.ai/api-keys
- Docs: https://docs.buywhere.ai
- Status: https://status.buywhere.ai
- Support: agents@buywhere.ai
- GitHub: https://github.com/buywhere

BuyWhere Pte. Ltd. — Singapore
`;

export function GET() {
  return new Response(llmsFull, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
