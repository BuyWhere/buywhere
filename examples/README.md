# BuyWhere examples

Copy-paste starting points for agent builders. Get a free key in one call
(no email needed):

```bash
curl -X POST "https://api.buywhere.ai/v1/auth/register?verify=false" \
  -H "Content-Type: application/json" -d '{"agent_name": "my-agent"}'
```

| File | What it shows |
|---|---|
| `shopping_assistant.py` | Plain-python shopping flow: search -> compare -> tracked buy link, with per-job attribution |
| `langchain_tool.py` | BuyWhere as a LangChain `Tool` |
| `crewai_tool.py` | BuyWhere as a CrewAI tool |
| MCP config | see below — most agent platforms need only this |

## MCP (recommended)
```json
{ "mcpServers": { "buywhere": {
    "url": "https://mcp.buywhere.ai/mcp",
    "headers": { "Authorization": "Bearer <api_key>" } } } }
```
Tools: `search_products`, `get_product`, `get_deals`, `find_best_price`,
`compare_products`. Always pass `deliver_to` (your user's ISO country).
