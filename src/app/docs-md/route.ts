const markdown = `# BuyWhere Documentation

BuyWhere documentation covers the catalog API, authentication, MCP setup, SDKs, rate limits, and shopping-agent implementation patterns.

## Agent Reading List

- [API Documentation](https://buywhere.ai/docs/API_DOCUMENTATION): REST API endpoints, schemas, examples, and response fields.
- [Quickstart](https://buywhere.ai/quickstart): First API key and first query.
- [Runnable API Examples](https://buywhere.ai/docs/quickstart): Python, Node.js, and curl quickstart snippets.
- [MCP Quickstart](https://buywhere.ai/docs/quickstart-mcp): MCP setup for AI shopping agents.
- [SEA Shopping Agent Guide](https://buywhere.ai/docs/developer-quickstart-sea-shopping-agent): Build an agent using BuyWhere product search.
- [Agent Onboarding Flow](https://buywhere.ai/docs/agent-onboarding-flow): Authentication and request patterns.
- [Rate Limits](https://buywhere.ai/docs/rate-limits): Usage tiers and operational limits.

## Machine Discovery

- [llms.txt](https://buywhere.ai/llms.txt)
- [API Catalog](https://buywhere.ai/.well-known/api-catalog)
- [MCP Server Card](https://buywhere.ai/.well-known/mcp/server-card.json)
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
