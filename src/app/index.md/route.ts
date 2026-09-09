const markdown = `# BuyWhere

BuyWhere is the product catalog API for AI agents. It exposes structured product search, offer comparison, catalog freshness, and merchant handoff paths for shopping-agent workflows.

## Start Here

- [Quickstart](https://buywhere.ai/quickstart): Get an API key and make the first catalog query.
- [Documentation](https://buywhere.ai/docs): Browse REST API, MCP, SDK, and integration guides.
- [MCP Integration](https://buywhere.ai/integrate): Connect BuyWhere to agent runtimes through MCP.
- [API Catalog](https://buywhere.ai/.well-known/api-catalog): Machine-readable API discovery.
- [MCP Server Card](https://buywhere.ai/.well-known/mcp/server-card.json): Machine-readable MCP discovery.

## Core Capabilities

- Search products across supported US and Southeast Asia commerce sources.
- Compare offers and route users to merchant destinations.
- Retrieve normalized product records for agent commerce workflows.
- Inspect catalog freshness and operational readiness signals.
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
