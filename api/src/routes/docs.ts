import { Router, Request, Response } from 'express';
import { API_BASE_URL } from '../config';

const router = Router();

// Shared Link headers for agent discoverability
function setLinkHeaders(res: Response) {
  res.set('Link', [
    '</.well-known/api-catalog>; rel="api-catalog"',
    '</.well-known/mcp.json>; rel="mcp-server-manifest"',
    '</openapi.json>; rel="describedby"',
  ].join(', '));
}

function buildMcpGuideMarkdown(baseUrl: string, mcpUrl: string): string {
  return `# BuyWhere MCP Integration

BuyWhere exposes its product catalog as an MCP (Model Context Protocol) server. AI agents can search, compare, and retrieve product data without writing HTTP glue code.

**Transport:** HTTP (\`POST ${mcpUrl}\`) for remote agents. STDIO (local process) coming soon via npm.

## Install

**The hosted MCP server is live.** Point your MCP client directly at \`${mcpUrl}\` — no local install required.

> **Note:** The \`buywhere-mcp\` npm package (for STDIO / local process mode) is not yet published. Use the HTTP transport below until it is available.

## Configure Claude Desktop

Add to \`~/Library/Application Support/Claude/claude_desktop_config.json\` (macOS) or \`%APPDATA%\\Claude\\claude_desktop_config.json\` (Windows):

\`\`\`json
{
  "mcpServers": {
    "buywhere": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer bw_live_xxx" }
    }
  }
}
\`\`\`

Restart Claude Desktop. The BuyWhere tools appear automatically.

## Configure Cursor

In \`.cursor/mcp.json\` in your project root (or \`~/.cursor/mcp.json\` globally):

\`\`\`json
{
  "mcpServers": {
    "buywhere": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer bw_live_xxx" }
    }
  }
}
\`\`\`

## Remote HTTP Transport

For agents running in cloud environments:

\`\`\`bash
POST ${mcpUrl}
Authorization: Bearer bw_live_xxx
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "search_products",
    "arguments": { "q": "wireless headphones", "region": "us", "max_price": 150 }
  },
  "id": 1
}
\`\`\`

## Available Tools

| Tool | Description |
|------|-------------|
| \`search_products\` | Search catalog by keyword, price range, platform, region, country |
| \`get_product\` | Full product details and current price by ID |
| \`compare_products\` | Side-by-side comparison of 2–10 products |
| \`get_deals\` | Discounted products sorted by discount percentage |
| \`list_categories\` | Browse available product categories |

## Python Quickstart

\`\`\`bash
pip install httpx
\`\`\`

\`\`\`python
import httpx, json

MCP_URL = "${mcpUrl}"
API_KEY  = "bw_live_xxx"   # POST ${baseUrl}/v1/auth/register

r = httpx.post(
    MCP_URL,
    headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
    json={
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "search_products",
            "arguments": {"q": "wireless headphones", "region": "us", "compact": True},
        },
        "id": 1,
    },
)
result = json.loads(r.json()["result"]["content"][0]["text"])
print(f"Found {result['meta']['total']} products")
for p in result["data"][:3]:
    print(f"  {p['title']}  {p['currency']} {p['price']}")
\`\`\`

> Also works with the official MCP Python SDK (\`pip install mcp\`) using \`streamablehttp_client\` pointed at the same URL.

## TypeScript Quickstart

Node 18+ has native \`fetch\`; no extra package needed.

\`\`\`typescript
const MCP_URL = "${mcpUrl}";
const API_KEY  = "bw_live_xxx";   // POST ${baseUrl}/v1/auth/register

const res = await fetch(MCP_URL, {
  method: "POST",
  headers: { Authorization: \`Bearer \${API_KEY}\`, "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "search_products",
      arguments: { q: "wireless headphones", region: "us", compact: true },
    },
    id: 1,
  }),
});

const data = await res.json();
const result = JSON.parse(data.result.content[0].text);
console.log(\`Found \${result.meta.total} products\`);
result.data.slice(0, 3).forEach((p: { title: string; currency: string; price: number }) =>
  console.log(\`  \${p.title}  \${p.currency} \${p.price}\`)
);
\`\`\`

> Using \`@modelcontextprotocol/sdk\`: \`npm install @modelcontextprotocol/sdk\`, then instantiate \`Client\` with \`StreamableHTTPClientTransport\` pointed at the same URL with an \`Authorization\` header.

## Agent Use Cases

### Price Comparison Bot

Search for a product, collect the top IDs, then compare them side-by-side:

\`\`\`json
// Step 1 — discover candidates
{ "method": "tools/call", "params": { "name": "search_products",
  "arguments": { "q": "running shoes", "compact": true, "limit": 5 } } }

// Step 2 — compare top results
{ "method": "tools/call", "params": { "name": "compare_products",
  "arguments": { "ids": ["<id1>", "<id2>", "<id3>"] } } }
\`\`\`

Rank the comparison output by \`normalized_price_usd\` (compact mode) to surface the best-value option.

### Deal Alert Bot

Poll for active discounts in a target market and filter by keyword:

\`\`\`json
{ "method": "tools/call", "params": { "name": "get_deals",
  "arguments": { "min_discount": 20, "country": "SG", "limit": 50 } } }
\`\`\`

Scan the returned \`title\` fields against your watchlist. Run on a schedule and notify when a match appears.

### Product Researcher

Discover available categories, then drill into structured specs for a given category:

\`\`\`json
// Step 1 — list categories
{ "method": "tools/call", "params": { "name": "list_categories", "arguments": {} } }

// Step 2 — fetch products with machine-readable specs
{ "method": "tools/call", "params": { "name": "search_products",
  "arguments": { "q": "electronics", "compact": true, "limit": 20 } } }
\`\`\`

Each result in compact mode includes \`structured_specs\` (brand, model, size, color) and \`comparison_attributes\` ready for agent reasoning.

## Authentication

Pass your API key as a Bearer token. Get a free key at \`POST ${baseUrl}/v1/auth/register\`.

| Key tier | Rate limit | Use case |
|----------|-----------|----------|
| \`bw_free_*\` | 60 req/min | Demo, testing |
| \`bw_live_*\` | 600 req/min | Production |
| \`bw_partner_*\` | Unlimited | Platform data partners |

## Error Handling

| MCP error code | Meaning |
|----------------|---------|
| \`invalid_params\` | Missing or invalid tool arguments |
| \`not_found\` | Product / category not found |
| \`rate_limited\` | Rate limit exceeded — implement exponential backoff |
| \`unauthorized\` | Invalid or missing API key |
| \`internal_error\` | BuyWhere API error |

## Links

- [OpenAPI spec](${baseUrl}/openapi.json)
- [Plugin manifest](${baseUrl}/.well-known/ai-plugin.json)
- [api@buywhere.ai](mailto:api@buywhere.ai)
`;
}

// GET /docs/guides/mcp
// Serves the MCP integration guide as HTML or markdown.
router.get('/guides/mcp', (req: Request, res: Response) => {
  const forwardedProto = req.headers['x-forwarded-proto'] as string | undefined;
  const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol;
  const host = req.headers['x-forwarded-host'] as string || req.get('host') || '';
  const isPublicHost = host && !host.startsWith('localhost') && !host.startsWith('127.');
  const baseUrl = isPublicHost ? `${proto}://${host}` : API_BASE_URL;
  const mcpUrl = `${API_BASE_URL}/mcp`;

  setLinkHeaders(res);

  if (req.accepts(['text/markdown', 'text/html']) === 'text/markdown') {
    res.set('X-Robots-Tag', 'ai-index');
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.type('text/markdown; charset=utf-8').send(buildMcpGuideMarkdown(baseUrl, mcpUrl));
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BuyWhere MCP Integration Guide</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 48px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 2rem; margin-bottom: .25em; }
  h2 { font-size: 1.3rem; margin-top: 2em; border-bottom: 1px solid #e5e5e5; padding-bottom: .3em; }
  h3 { font-size: 1.05rem; margin-top: 1.5em; }
  pre { background: #f6f8fa; border: 1px solid #e5e5e5; border-radius: 6px; padding: 16px; overflow-x: auto; }
  code { font-family: "SFMono-Regular", Consolas, monospace; font-size: .9em; }
  p code, li code { background: #f6f8fa; border: 1px solid #e5e5e5; border-radius: 3px; padding: 2px 5px; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }
  th { background: #f6f8fa; }
  .callout { background: #fff8e1; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin: 1em 0; }
  a { color: #0969da; }
</style>
</head>
<body>
<h1>BuyWhere MCP Integration</h1>
<p>BuyWhere exposes its product catalog as an MCP (Model Context Protocol) server. AI agents can search, compare, and retrieve product data without writing HTTP glue code.</p>
<p><strong>Transport:</strong> HTTP (<code>POST ${mcpUrl}</code>) for remote agents. STDIO (local process) coming soon via npm.</p>

<h2>Install</h2>
<p><strong>The hosted MCP server is live.</strong> Point your MCP client directly at <code>${mcpUrl}</code> — no local install required.</p>
<div class="callout">
  <strong>Note:</strong> The <code>buywhere-mcp</code> npm package (for STDIO / local process mode) is not yet published. Use the HTTP transport below until it is available.
</div>

<h2>Configure Claude Desktop</h2>
<p>Add to <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS) or <code>%APPDATA%\\Claude\\claude_desktop_config.json</code> (Windows):</p>
<pre><code>{
  "mcpServers": {
    "buywhere": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer bw_live_xxx" }
    }
  }
}</code></pre>
<p>Restart Claude Desktop. The BuyWhere tools appear automatically.</p>

<h2>Configure Cursor</h2>
<p>In <code>.cursor/mcp.json</code> in your project root (or <code>~/.cursor/mcp.json</code> globally):</p>
<pre><code>{
  "mcpServers": {
    "buywhere": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer bw_live_xxx" }
    }
  }
}</code></pre>

<h2>Remote HTTP Transport</h2>
<p>For agents running in cloud environments:</p>
<pre><code>POST ${mcpUrl}
Authorization: Bearer bw_live_xxx
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "search_products",
    "arguments": { "q": "wireless headphones", "region": "us", "max_price": 150 }
  },
  "id": 1
}</code></pre>

<p>Filter by country:</p>
<pre><code>POST ${mcpUrl}
Authorization: Bearer bw_live_xxx
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "search_products",
    "arguments": { "q": "laptop", "country": "SG" }
  },
  "id": 2
}</code></pre>

<h2>Available Tools</h2>
<table>
<tr><th>Tool</th><th>Description</th></tr>
<tr><td><code>search_products</code></td><td>Search catalog by keyword, price range, platform, region, country</td></tr>
<tr><td><code>get_product</code></td><td>Full product details and current price by ID</td></tr>
<tr><td><code>compare_products</code></td><td>Side-by-side comparison of 2–10 products</td></tr>
<tr><td><code>get_deals</code></td><td>Discounted products sorted by discount percentage</td></tr>
<tr><td><code>list_categories</code></td><td>Browse available product categories</td></tr>
</table>

<h2>Python Quickstart</h2>
<pre><code>pip install httpx</code></pre>
<pre><code>import httpx, json

MCP_URL = "${mcpUrl}"
API_KEY  = "bw_live_xxx"   # POST ${baseUrl}/v1/auth/register

r = httpx.post(
    MCP_URL,
    headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
    json={
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "search_products",
            "arguments": {"q": "wireless headphones", "region": "us", "compact": True},
        },
        "id": 1,
    },
)
result = json.loads(r.json()["result"]["content"][0]["text"])
print(f"Found {result['meta']['total']} products")
for p in result["data"][:3]:
    print(f"  {p['title']}  {p['currency']} {p['price']}")</code></pre>
<p>Also works with the official MCP Python SDK (<code>pip install mcp</code>) using <code>streamablehttp_client</code> pointed at the same URL.</p>

<h2>TypeScript Quickstart</h2>
<p>Node 18+ has native <code>fetch</code>; no extra package needed.</p>
<pre><code>const MCP_URL = "${mcpUrl}";
const API_KEY  = "bw_live_xxx";   // POST ${baseUrl}/v1/auth/register

const res = await fetch(MCP_URL, {
  method: "POST",
  headers: { Authorization: \`Bearer \${API_KEY}\`, "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "search_products",
      arguments: { q: "wireless headphones", region: "us", compact: true },
    },
    id: 1,
  }),
});

const data = await res.json();
const result = JSON.parse(data.result.content[0].text);
console.log(\`Found \${result.meta.total} products\`);
result.data.slice(0, 3).forEach(p =>
  console.log(\`  \${p.title}  \${p.currency} \${p.price}\`)
);</code></pre>
<p>Using <code>@modelcontextprotocol/sdk</code>: <code>npm install @modelcontextprotocol/sdk</code>, then instantiate <code>Client</code> with <code>StreamableHTTPClientTransport</code> pointed at the same URL with an <code>Authorization</code> header.</p>

<h2>Agent Use Cases</h2>

<h3>Price Comparison Bot</h3>
<p>Search for a product, collect the top IDs, then compare them side-by-side:</p>
<pre><code>// Step 1 — discover candidates
{ "method": "tools/call", "params": { "name": "search_products",
  "arguments": { "q": "running shoes", "compact": true, "limit": 5 } } }

// Step 2 — compare top results
{ "method": "tools/call", "params": { "name": "compare_products",
  "arguments": { "ids": ["&lt;id1&gt;", "&lt;id2&gt;", "&lt;id3&gt;"] } } }</code></pre>
<p>Rank the comparison output by <code>normalized_price_usd</code> (compact mode) to surface the best-value option.</p>

<h3>Deal Alert Bot</h3>
<p>Poll for active discounts in a target market and filter by keyword:</p>
<pre><code>{ "method": "tools/call", "params": { "name": "get_deals",
  "arguments": { "min_discount": 20, "country": "SG", "limit": 50 } } }</code></pre>
<p>Scan the returned <code>title</code> fields against your watchlist. Run on a schedule and notify when a match appears.</p>

<h3>Product Researcher</h3>
<p>Discover available categories, then drill into structured specs:</p>
<pre><code>// Step 1 — list categories
{ "method": "tools/call", "params": { "name": "list_categories", "arguments": {} } }

// Step 2 — fetch products with machine-readable specs
{ "method": "tools/call", "params": { "name": "search_products",
  "arguments": { "q": "electronics", "compact": true, "limit": 20 } } }</code></pre>
<p>Each result in compact mode includes <code>structured_specs</code> (brand, model, size, color) and <code>comparison_attributes</code> ready for agent reasoning.</p>

<h2>CORS Policy</h2>
<p>The BuyWhere API sets <code>Access-Control-Allow-Origin: *</code> (wildcard) on all endpoints, including <code>/mcp</code> and all <code>/v1/</code> REST routes.</p>
<div class="callout">
  <strong>Why wildcard?</strong> BuyWhere is a public, API-key-gated service. AI agents call the API from cloud functions, CI runners, local dev environments, and embedded runtimes — their origins are unpredictable and not meaningful security boundaries. The API key is the authentication and authorization boundary; the request origin is not. Restricting CORS to a fixed origin list would break legitimate agent use cases without adding security value.
</div>
<p><strong>Implications for integrators:</strong></p>
<ul>
  <li>Browser-based clients can call the API directly. Your API key will be visible in client-side code — use a backend proxy for production web apps if key secrecy matters.</li>
  <li>No preflight CORS configuration is needed on your side.</li>
  <li>All rate limits and access controls are enforced by the API key tier, not by origin.</li>
</ul>

<h2>Currency and FX Rates</h2>
<p>Product prices are stored and returned in the product's native currency (<code>SGD</code>, <code>USD</code>, <code>VND</code>, <code>THB</code>, <code>MYR</code>). The API does <strong>not</strong> convert prices dynamically.</p>
<h3>normalized_price_usd (compact mode only)</h3>
<p>When you request <code>?compact=true</code> on <code>/v1/products/search</code>, each product includes a <code>normalized_price_usd</code> field. This is computed using static, approximate exchange rates:</p>
<table>
<tr><th>Currency</th><th>Rate to USD</th><th>Basis</th></tr>
<tr><td>USD</td><td>1.0</td><td>exact</td></tr>
<tr><td>SGD</td><td>0.74</td><td>approx. Q1 2026</td></tr>
<tr><td>MYR</td><td>0.22</td><td>approx. Q1 2026</td></tr>
<tr><td>THB</td><td>0.028</td><td>approx. Q1 2026</td></tr>
<tr><td>VND</td><td>0.000039</td><td>approx. Q1 2026</td></tr>
</table>
<div class="callout">
  <strong>Important limitations:</strong> <code>normalized_price_usd</code> is intended solely for cross-currency ordering and rough comparison by AI agents (e.g. "sort these results by approximate USD price"). It is <strong>not</strong> suitable for billing, financial reporting, or display to end users. Rates are static and are not updated in real time — they will drift as exchange rates change. Do not aggregate, sum, or present these values as accurate USD prices.
</div>
<p><strong>Why static rates?</strong> Real-time FX rate lookups would add an external API dependency, latency on every search request, and a failure mode with no clean fallback. For the intended use case — helping an AI agent rank or filter cross-currency results — Q1-2026 approximate rates are sufficient. The tradeoff is documented here so integrators know exactly what they are getting.</p>
<p>The <code>/v1/products/compare</code> endpoint does not include normalized prices. When products span multiple currencies, the response includes a <code>currency_warning</code> field advising agents not to rank by price across currencies.</p>

<h2>Authentication</h2>
<p>Pass your API key as a Bearer token. Get a free key at <code>POST ${baseUrl}/v1/auth/register</code>.</p>
<table>
<tr><th>Key tier</th><th>Rate limit</th><th>Use case</th></tr>
<tr><td><code>bw_free_*</code></td><td>60 req/min</td><td>Demo, testing</td></tr>
<tr><td><code>bw_live_*</code></td><td>600 req/min</td><td>Production</td></tr>
<tr><td><code>bw_partner_*</code></td><td>Unlimited</td><td>Platform data partners</td></tr>
</table>

<h2>Error Handling</h2>
<table>
<tr><th>MCP error code</th><th>Meaning</th></tr>
<tr><td><code>invalid_params</code></td><td>Missing or invalid tool arguments</td></tr>
<tr><td><code>not_found</code></td><td>Product / category not found</td></tr>
<tr><td><code>rate_limited</code></td><td>Rate limit exceeded — implement exponential backoff (2s → 4s → 8s)</td></tr>
<tr><td><code>unauthorized</code></td><td>Invalid or missing API key</td></tr>
<tr><td><code>internal_error</code></td><td>BuyWhere API error</td></tr>
</table>

<p style="margin-top:3em;color:#6b7280;font-size:.85em">
  <a href="${baseUrl}/openapi.json">OpenAPI spec</a> ·
  <a href="${baseUrl}/.well-known/ai-plugin.json">Plugin manifest</a> ·
  <a href="mailto:api@buywhere.ai">api@buywhere.ai</a>
</p>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'ai-index');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.send(html);
});

// Redirect /docs to the MCP guide (most common entry point)
router.get('/', (_req: Request, res: Response) => {
  res.redirect(301, '/docs/guides/mcp');
});

export default router;
