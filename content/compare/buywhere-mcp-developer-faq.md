# BuyWhere MCP FAQ — Developer Edition

Answers to common developer questions about MCP, BuyWhere tools, and building AI shopping agents.

---

## What is MCP?

MCP (Model Context Protocol) is an open standard that lets AI models call external tools through a standardized interface. Instead of hardcoding API calls, an MCP server exposes tools that any MCP-compatible client can discover and use. Think of it as "USB for AI tools" — one integration works across all MCP clients.

---

## How does BuyWhere use MCP?

BuyWhere exposes its product catalog API as MCP tools. When you configure `@buywhere/mcp-server` in Claude Desktop, Cursor, or any MCP client, the client can call tools like `search_products` and `get_deals` without you writing any API integration code.

---

## What tools does BuyWhere expose?

| Tool | Purpose |
|------|---------|
| `search_products` | Full-text product search across all merchants |
| `get_product` | Get product details by ID |
| `compare_products` | Compare multiple products side-by-side |
| `get_deals` | Find products with active discounts |
| `list_categories` | Browse available categories |
| `find_best_price` | Find cheapest price for a product |
| `resolve_product_query` | Classify natural language shopping intent and route to the right catalog capability |

---

## Which MCP clients support BuyWhere?

Any MCP-compatible client works. Tested and documented:

- **Claude Desktop** (Anthropic) — Native MCP support
- **Cursor** — MCP settings panel
- **Cline** — MCP configuration
- **Windsurf** — MCP integration
- **VS Code** (with MCP extension)
- **LangChain** — Tool integration
- **CrewAI** — Tool registration
- **AutoGen** — Function tool binding
- **LlamaIndex** — FunctionSpec definitions

---

## Do I need a credit card to start?

No. The BuyWhere free tier includes 1,000 API calls per month with no time limit and no credit card required.

---

## What countries are supported?

Singapore (SGD), United States (USD), Malaysia (MYR), Thailand (THB), Vietnam (VND), Philippines (PHP), Indonesia (IDR).

---

## How is data freshness handled?

Product data is refreshed periodically. Real-time accuracy cannot be guaranteed — prices and stock change constantly. Use the `get_product` call for current prices before purchase decisions.

---

## Can I use BuyWhere without MCP?

Yes. The same product catalog is available via REST API at `api.buywhere.ai/v1`. MCP is an optional wrapper that makes the tools available to AI agents with zero custom integration code.

---

## How do I debug MCP tool calls?

Most MCP clients log tool calls and responses. For Claude Desktop, check the developer console. For Cursor, the MCP settings panel shows server logs. You can also test directly with:

```bash
# Test the MCP server
npx -y @buywhere/mcp-server --verbose
```

---

## Can I contribute to BuyWhere MCP?

The server is open source. File issues or PRs at the BuyWhere GitHub repo. Feature requests, merchant additions, and bug reports are welcome.

---

## Related

- [BuyWhere API Docs](https://api.buywhere.ai/docs)
- [BuyWhere NPM Package](https://www.npmjs.com/package/@buywhere/mcp-server)
- [Smithery Listing](https://smithery.ai/servers/buywhere)
- [Glama Listing](https://glama.ai/mcp/servers/BuyWhere/buywhere-mcp)

