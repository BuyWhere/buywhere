# Developer Growth Outreach Pack

Owner: Reach
Issue: BUY-2040
Created: 2026-04-27

## Goal

Drive qualified API-key signups from AI agent developers by sharing concrete use cases, runnable examples, and MCP / agent-integration entry points.

Primary CTA: `https://api.buywhere.ai/docs`

## UTM Conventions

| Channel | Docs URL | MCP URL |
|---|---|---|
| Discord | `https://api.buywhere.ai/docs?utm_source=discord&utm_medium=community&utm_campaign=developer-growth-apr27` | `https://api.buywhere.ai/docs/guides/mcp?utm_source=discord&utm_medium=community&utm_campaign=developer-growth-apr27` |
| Reddit | `https://api.buywhere.ai/docs?utm_source=reddit&utm_medium=community&utm_campaign=developer-growth-apr27` | `https://api.buywhere.ai/docs/guides/mcp?utm_source=reddit&utm_medium=community&utm_campaign=developer-growth-apr27` |
| X | `https://api.buywhere.ai/docs?utm_source=x&utm_medium=social&utm_campaign=developer-growth-apr27` | `https://api.buywhere.ai/docs/guides/mcp?utm_source=x&utm_medium=social&utm_campaign=developer-growth-apr27` |
| Dev.to | `https://api.buywhere.ai/docs?utm_source=devto&utm_medium=community&utm_campaign=developer-growth-apr27` | `https://api.buywhere.ai/docs/guides/mcp?utm_source=devto&utm_medium=community&utm_campaign=developer-growth-apr27` |
| LinkedIn | `https://api.buywhere.ai/docs?utm_source=linkedin&utm_medium=social&utm_campaign=developer-growth-apr27` | `https://api.buywhere.ai/docs/guides/mcp?utm_source=linkedin&utm_medium=social&utm_campaign=developer-growth-apr27` |

## Channel Templates

### Discord

Best for: tool showcase, MCP, "what API should I use?" help channels

```
If you're building a shopping or deal-finding agent, one painful part is getting live product data without maintaining scrapers for every store.

We built BuyWhere to solve that layer directly: product search, best-price lookup, comparisons, and MCP access over a single API for Singapore commerce data.

Docs: https://api.buywhere.ai/docs?utm_source=discord&utm_medium=community&utm_campaign=developer-growth-apr27
MCP guide: https://api.buywhere.ai/docs/guides/mcp?utm_source=discord&utm_medium=community&utm_campaign=developer-growth-apr27
```

### Reddit

Best for: replies to "how do I build a shopping agent" threads, MCP tool threads

```
One approach is to separate the agent logic from the commerce-data problem.

If your agent is scraping merchant sites directly, you will spend most of your time on selectors, anti-bot issues, and schema cleanup. A cleaner setup is to use a product-catalog API as the retrieval layer and keep the LLM focused on reasoning.

We have been doing that with BuyWhere for Singapore product search / comparison / best-price flows:
https://api.buywhere.ai/docs?utm_source=reddit&utm_medium=community&utm_campaign=developer-growth-apr27

I work on it, so biased, but the architectural point stands either way: keep scraping out of the agent runtime if you can.
```

### X / Twitter

Best for: replies to agent-building threads, MCP discussions

```
Most "AI shopping agents" are really LLMs sitting on top of fragile scrapers.

Better pattern:
- agent handles planning
- catalog API handles retrieval
- MCP exposes tools cleanly

BuyWhere is the API layer we built for this in Singapore:
Docs: https://api.buywhere.ai/docs?utm_source=x&utm_medium=social&utm_campaign=developer-growth-apr27
MCP: https://api.buywhere.ai/docs/guides/mcp?utm_source=x&utm_medium=social&utm_campaign=developer-growth-apr27
```

### Dev.to / Hashnode

Best for: comments on MCP, LangChain, CrewAI, tool-calling articles

```
Strong write-up. One pattern that helps in production is keeping merchant retrieval outside the agent itself.

For commerce use cases, we expose product search, comparison, and best-price as a dedicated API + MCP layer, then let the agent decide when to call those tools.

Docs if useful:
https://api.buywhere.ai/docs?utm_source=devto&utm_medium=community&utm_campaign=developer-growth-apr27
```

## Daily Execution Target

Per day:
- 1 Discord contribution
- 1 Reddit comment or thread reply
- 1 X reply or post
- 1 Dev.to or Hashnode comment

## Qualification Signals

Good audience:
- asks about LangChain, CrewAI, Claude Desktop, MCP, tool calling, or product retrieval
- building price comparison, affiliate, shopping, or recommendation agents
- wants data freshness or structured product metadata

Skip:
- consumer deal hunting with no developer angle
- generic AI hype threads
- communities that moderate obvious product promotion

## Success Tracking

Track:
- post URL
- clicks
- replies
- DMs
- API key signups if reported