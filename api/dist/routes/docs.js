"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const router = (0, express_1.Router)();
// GET /docs/guides/mcp
// Serves the MCP integration guide as HTML.
// This route exists because api.buywhere.ai/docs/guides/mcp was referenced as
// the canonical MCP guide URL in public materials (BUY-579 / Aria DevRel audit).
router.get('/guides/mcp', (req, res) => {
    // Derive the public base URL from the incoming request so the guide is
    // correct even if API_BASE_URL env var is misconfigured (e.g. localhost).
    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host') || '';
    // Only use request-derived URL if it looks like a real public host (not localhost/127)
    const isPublicHost = host && !host.startsWith('localhost') && !host.startsWith('127.');
    const baseUrl = isPublicHost ? `${proto}://${host}` : config_1.API_BASE_URL;
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
<p><strong>Transport:</strong> HTTP (<code>POST ${baseUrl}/mcp</code>) for remote agents. STDIO (local process) coming soon via npm.</p>

<h2>Install</h2>
<p><strong>The hosted MCP server is live.</strong> Point your MCP client directly at <code>${baseUrl}/mcp</code> — no local install required.</p>
<div class="callout">
  <strong>Note:</strong> The <code>buywhere-mcp</code> npm package (for STDIO / local process mode) is not yet published. Use the HTTP transport below until it is available.
</div>

<h2>Configure Claude Desktop</h2>
<p>Add to <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS) or <code>%APPDATA%\\Claude\\claude_desktop_config.json</code> (Windows):</p>
<pre><code>{
  "mcpServers": {
    "buywhere": {
      "url": "${baseUrl}/mcp",
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
      "url": "${baseUrl}/mcp",
      "headers": { "Authorization": "Bearer bw_live_xxx" }
    }
  }
}</code></pre>

<h2>Remote HTTP Transport</h2>
<p>For agents running in cloud environments:</p>
<pre><code>POST ${baseUrl}/mcp
Authorization: Bearer bw_live_xxx
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "search_products",
    "arguments": { "query": "wireless headphones", "max_price": 150 }
  },
  "id": 1
}</code></pre>

<h2>Available Tools</h2>
<table>
<tr><th>Tool</th><th>Description</th></tr>
<tr><td><code>search_products</code></td><td>Search catalog by keyword, category, price range, platform, country</td></tr>
<tr><td><code>get_product</code></td><td>Full product details by ID</td></tr>
<tr><td><code>get_price</code></td><td>Current prices across all merchants for a product</td></tr>
<tr><td><code>compare_prices</code></td><td>Side-by-side comparison of 2–5 products</td></tr>
<tr><td><code>get_affiliate_link</code></td><td>Click-tracked BuyWhere affiliate link for a product</td></tr>
<tr><td><code>get_catalog</code></td><td>Browse available product categories</td></tr>
</table>

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
    res.send(html);
});
// Redirect /docs to the MCP guide (most common entry point)
router.get('/', (_req, res) => {
    res.redirect(301, '/docs/guides/mcp');
});
exports.default = router;
