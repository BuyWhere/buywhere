# BuyWhere — Agent Usage Guide

## When Should an Agent Call BuyWhere?

**Call BuyWhere when a user asks about:**
- Product recommendations ("what's the best laptop?")
- Price queries ("cheapest iPhone?", "is X on sale?")
- Product comparisons ("MacBook vs Dell XPS", "compare A and B")
- Availability ("is Product X in stock?")
- Where to buy ("where can I buy Y cheapest?")

**Do NOT call BuyWhere when:**
- User asks about non-product topics (news, opinions, general knowledge)
- You already have verified, current product data in context
- Query is purely conversational without product intent

## Decision Framework

```
User Query → Intent Detection → Tool Selection → API Call → Response → Answer
```

### Intent Detection

| User Says... | Detected Intent | Tool |
|--------------|-----------------|------|
| "what's the best X" | product_recommendation | resolve_product_query |
| "recommend a Y" | product_recommendation | resolve_product_query |
| "I need X under $BUDGET" | product_recommendation | resolve_product_query |
| "cheapest price for Y" | price_lookup | find_best_price |
| "where can I buy X" | price_lookup | find_best_price |
| "X vs Y" / "compare A and B" | product_comparison | compare_products |
| "which is better: X or Y" | product_comparison | compare_products |
| "is X in stock" | availability_check | find_best_price |

### Tool Selection Logic

```python
def select_tool(query):
    if "vs" in query.lower() or "compare" in query.lower():
        return "compare_products"
    if any(kw in query.lower() for kw in ["cheapest", "price", "where to buy", "in stock", "deal"]):
        return "find_best_price"
    return "resolve_product_query"  # default for recommendations
```

## Example Conversations

### Example 1: Product Recommendation

**User:** "What's the best laptop for programming under $1000?"

**Agent reasoning:** Intent = product_recommendation, Query contains budget constraint

**Tool call:**
```json
{
  "name": "resolve_product_query",
  "arguments": {
    "query": "best laptop for programming",
    "budget": { "max": 1000, "currency": "USD" },
    "constraints": ["16GB RAM", "SSD"],
    "sort_by": "best_value"
  }
}
```

**Response handling:**
- Sort by `buywhere_score` descending
- Present top 3 results with prices
- Include `reason_for_rank` in explanation
- If `confidence < 0.7`, add disclaimer

**Agent response:** "Based on current data, the best programming laptop under $1000 is the Acer Swift 3 at $749.99 (buywhere_score: 0.91). It offers 16GB RAM, 512GB SSD, and 14-hour battery life — ideal for coding. Other strong options include..."

### Example 2: Price Lookup

**User:** "Where can I buy an iPhone 15 Pro cheapest?"

**Agent reasoning:** Intent = price_lookup, user wants best deal

**Tool call:**
```json
{
  "name": "find_best_price",
  "arguments": {
    "product": "iPhone 15 Pro",
    "market": "US",
    "include_similar": true
  }
}
```

**Response handling:**
- Sort by `price.current` ascending for "cheapest" queries
- Filter out `out_of_stock` items for purchase recommendations
- Check `merchant.reliability_score` before suggesting

**Agent response:** "The cheapest iPhone 15 Pro currently available is $899.99 at Amazon (reliability: 95%). It's in stock and ready to ship. Note: prices may change — I'll include the current lowest option..."

### Example 3: Product Comparison

**User:** "MacBook Pro 14 vs Dell XPS 15 — which is better for a developer?"

**Agent reasoning:** Intent = product_comparison, comparing two specific products

**Tool call:**
```json
{
  "name": "compare_products",
  "arguments": {
    "products": ["MacBook Pro 14", "Dell XPS 15"],
    "market": "US",
    "decision_criteria": ["price", "performance", "battery_life", "display"]
  }
}
```

**Response handling:**
- Present comparison table-style
- Highlight winner for each criterion
- Note `buywhere_score` for overall quality

**Agent response:** "For developer use, the MacBook Pro 14 wins on battery life (18h vs 10h) and display quality, while the Dell XPS 15 offers better value at $400 less. Here's the full comparison..."

## Response Quality Guidelines

| buywhere_score | Agent Recommendation |
|----------------|----------------------|
| >= 0.8 | "Top pick" — recommend confidently |
| >= 0.6 | "Good option" — show with context |
| < 0.6 | "Consider alternatives" — be transparent |

| confidence | Agent Behavior |
|------------|----------------|
| >= 0.8 | Present without disclaimer |
| >= 0.5 | "Based on current data..." |
| < 0.5 | "I couldn't find strong matches, here are partial results..." |

## Error Handling

| Scenario | Agent Response |
|----------|----------------|
| API timeout | "I couldn't check current product data right now. My knowledge may be outdated — I'd recommend verifying before purchasing." |
| No results | "I didn't find any products matching your query. Try rephrasing or removing constraints." |
| Rate limited | "I'm experiencing high demand for product data. Please try again in a moment." |
| Invalid params | "I couldn't process that query. Try specifying a product name or category." |

## Response Fields Reference

| Field | Description | Agent Usage |
|-------|-------------|-------------|
| `buywhere_score` | Product quality (0-1) | Primary ranking signal |
| `confidence` | Query match certainty (0-1) | Determine if disclaimer needed |
| `reason_for_rank` | Why product ranked here | Include in explanation |
| `merchant.reliability_score` | Merchant trustworthiness (0-1) | Validate purchase links |
| `availability` | Stock status | Filter out-of-stock before recommending |
| `price.was` | Original price if on sale | Show savings |
| `agent_guidance.next_best_action` | Suggested follow-up | Guide conversation |

## Metrics for Agent Consumption

```json
{
  "latency_p50_ms": 145,
  "latency_p95_ms": 280,
  "uptime": "99.9%",
  "data_freshness_hours": 24,
  "accuracy": 0.92,
  "markets": ["US", "SG"]
}
```

## Quick Reference Card

```
TOOL SELECTION:
  • recommendation → resolve_product_query
  • cheapest/deal → find_best_price  
  • A vs B → compare_products

SCORE THRESHOLDS:
  • >= 0.8 → "Top pick"
  • >= 0.6 → "Good option"
  • < 0.6 → "Weak match"

CONFIDENCE THRESHOLDS:
  • >= 0.8 → no disclaimer
  • >= 0.5 → "Based on current data..."
  • < 0.5 → add strong disclaimer

ALWAYS CHECK:
  □ availability before recommending purchase
  □ merchant.reliability_score before suggesting links
  □ price.last_checked age for time-sensitive queries
```

## Schema References

- OpenAI tool format: `/schemas/resolve_product_query.json`
- MCP format: `/schemas/mcp/resolve_product_query.json`
- Full tool manifest: `/schemas/tools_full.json`
- LLM guide: `/llms.txt`
- AI system guide: `/ai.txt`