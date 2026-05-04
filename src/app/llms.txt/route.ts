export const dynamic = 'force-static';

const llms = `# BuyWhere — Agent-Native Product Catalog API

> BuyWhere is a product catalog API designed for AI agents and LLM pipelines. It provides semantic product search, normalized pricing data, and real-time availability across Singapore retailers.

## What BuyWhere Does

BuyWhere indexes products from Singapore's major e-commerce platforms (Lazada, Shopee, Qoo10, and more) and exposes them through a unified REST API. AI agents can search for products in natural language, retrieve structured product data, and generate affiliate links — without scraping or parsing inconsistent HTML.

## API Endpoints

- **Product Search**: \`GET https://api.buywhere.ai/v1/search?q={query}&limit=10\`
- **Product Detail**: \`GET https://api.buywhere.ai/v1/products/{id}\`
- **Best Price**: \`GET https://api.buywhere.ai/v1/products/best-price?product_name={name}\`
- **Deals**: \`GET https://api.buywhere.ai/v1/deals\`
- **Categories**: \`GET https://api.buywhere.ai/v1/categories\`

All endpoints return JSON. Authentication uses Bearer tokens via the \`Authorization\` header.

## Authentication

\`\`\`
Authorization: Bearer bw_live_YOUR_API_KEY
\`\`\`

Get an API key at: https://buywhere.ai/quickstart

## Example: Search Products

\`\`\`bash
curl -X GET "https://api.buywhere.ai/v1/search" \\
  -H "Authorization: Bearer bw_live_YOUR_API_KEY" \\
  -G \\
  --data-urlencode "q=wireless headphones under $150" \\
  --data-urlencode "limit=5"
\`\`\`

## Response Schema

\`\`\`json
{
  "total": 47,
  "limit": 5,
  "offset": 0,
  "has_more": true,
  "items": [
    {
      "id": 12345,
      "name": "Sony WH-1000XM5 Wireless Headphones",
      "price": 429.00,
      "currency": "SGD",
      "source": "lazada_sg",
      "buy_url": "https://lazada.sg/products/...",
      "affiliate_url": "https://api.buywhere.ai/v1/track/12345",
      "image_url": "https://img.lazcdn.com/...",
      "is_available": true,
      "rating": 4.8,
      "category": "Electronics > Audio > Headphones"
    }
  ]
}
\`\`\`

## Use Cases for AI Agents

- **Shopping assistants**: Find the best deal across retailers in natural language
- **Price comparison**: Track and compare prices across Lazada, Shopee, Qoo10
- **Affiliate commerce**: Generate revenue by embedding affiliate product links
- **Product recommendations**: Structured data for recommendation engines

## Developer Resources

- Quickstart guide: https://buywhere.ai/quickstart
- Full API docs: https://richmondteo-code.github.io/buywhere-catalog-api/
- Agent examples (LangChain + CrewAI): https://github.com/richmondteo-code/buywhere-agent-examples
- Python: \`pip install langchain langchain-openai requests\` (no BuyWhere SDK needed — see examples repo)
- TypeScript/Node: native \`fetch\` API, no dependencies (Node 18+)

## Rate Limits

- Free: 10 req/min, 1,000 queries/month
- Starter: 60 req/min, 100,000 queries/month
- Growth: 300 req/min, 1,000,000 queries/month
- Scale: 1,000 req/min, unlimited

## Company

BuyWhere Pte. Ltd. — Singapore
Contact: hello@buywhere.ai
Website: https://buywhere.ai
`;

export function GET() {
  return new Response(llms, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
