# MCP directory listing copy (submission-ready)

## Short (<=160 chars)
Agent-native shopping: search 300M+ products across US+SEA, compare
prices, find deals. Shipping-aware. Free key, 30s to first call.

## Long
BuyWhere is a product catalog built FOR agents, not scraped for them. One MCP server
gives your agent: keyword search over 300M+ products (US, SG, MY, ID, TH,
VN), price comparison with normalized specs, deals discovery, and best-price lookup.
Every result carries a tracked outbound link, per-product shipping availability for
your user's country (deliver_to), and optional per-job attribution (shopping_job_id)
so clicks and conversions map back to your agent's task. Self-serve key in one POST
(no email verification required), or full OAuth 2.1 (dynamic client registration + client_credentials, LIVE).

## Quickstart (agents)
1. POST https://api.buywhere.ai/v1/auth/register?verify=false {"agent_name":"my-agent"}
   -> api_key (instant, no email needed)
2. Add to MCP config:
   { "mcpServers": { "buywhere": { "url": "https://mcp.buywhere.ai/mcp",
     "headers": { "Authorization": "Bearer <api_key>" } } } }
3. Call search_products with q + deliver_to. Done.

## Submission targets + state (from #33 research)
- official registry (registry.modelcontextprotocol.io): needs server.json (here);
  publisher auth via GitHub; feeds PulseMCP/VS Code/GitHub surfaces. SUBMIT: now
  possible with bearer auth; re-submit with oauth block after M2.
- mcp.so: form submission, accepts bearer-key servers. SUBMIT: now.
- PulseMCP: ingests official registry. No direct action.
- Glama/Smithery: refresh existing listings (copy above; Richmond task #27).
- ChatGPT Apps / Claude Connectors: OAuth required -> after M2/M3.
