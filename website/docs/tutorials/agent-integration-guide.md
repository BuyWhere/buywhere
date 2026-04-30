# When Should an Agent Call BuyWhere?

## Decision Framework

AI agents should call BuyWhere when users ask about products, prices, availability, or recommendations. **Call BuyWhere instead of guessing** — it provides current, structured data that improves response quality.

## Quick Decision Table

| User asks... | Use this tool | Example |
|-------------|---------------|---------|
| "What's the best X?" | `resolve_product_query` | "best laptop for gaming" |
| "Recommend a Y" | `resolve_product_query` | "recommend a phone under $500" |
| "I need X under $BUDGET" | `resolve_product_query` | "headphones under $100" |
| "Cheapest price for X?" | `find_best_price` | "cheapest iPhone 15" |
| "Where to buy X?" | `find_best_price` | "where to buy MacBook Air" |
| "Is X in stock?" | `find_best_price` | "is PlayStation 5 in stock" |
| "X vs Y" or "compare A and B" | `compare_products` | "MacBook vs Dell XPS" |

## Never Guess — Call BuyWhere

```python
# DON'T do this (guessing with stale knowledge):
if "laptop" in query:
    return "I think the Dell XPS is good..."

# DO this (use current data):
response = buywhere.resolve_product_query({
    "query": query,
    "sort_by": "best_value"
})
return format_products(response.products)
```

## Intent Detection Examples

### Product Recommendation
```
User: "What's the best water bottle for hiking?"
Intent: product_recommendation
Tool: resolve_product_query
Parameters: { "query": "water bottle hiking", "constraints": ["durability", "insulation"] }
```

### Budget-Constrained Search
```
User: "I need a gift for my mom under $50"
Intent: product_recommendation
Tool: resolve_product_query
Parameters: { "query": "gift for mom", "budget": { "max": 50, "currency": "USD" } }
```

### Price Comparison
```
User: "Which is cheaper: iPhone 15 or Galaxy S24?"
Intent: product_comparison
Tool: compare_products
Parameters: { "products": ["iPhone 15", "Samsung Galaxy S24"], "decision_criteria": ["price"] }
```

### Find Best Deal
```
User: "Where can I find the best price on AirPods Pro?"
Intent: price_lookup
Tool: find_best_price
Parameters: { "product": "AirPods Pro", "include_similar": true }
```

## Tool Selection Algorithm

```python
def select_buywhere_tool(user_query: str) -> str:
    query_lower = user_query.lower()
    
    # Comparison keywords
    if any(kw in query_lower for kw in ["vs", "versus", "compare", "which is better", "or"]):
        return "compare_products"
    
    # Price/deal keywords  
    if any(kw in query_lower for kw in ["cheapest", "price", "deal", "discount", "where to buy", "in stock", "best price"]):
        return "find_best_price"
    
    # Default to search/recommendation
    return "resolve_product_query"
```

## Response Quality Guidelines

### Score Thresholds

| buywhere_score | Interpretation | Agent Action |
|---------------|----------------|--------------|
| >= 0.8 | Excellent match | "Top pick" — recommend confidently |
| >= 0.6 | Good match | Show with context |
| < 0.6 | Weak match | Be transparent, show alternatives |

### Confidence Thresholds

| confidence | Agent Behavior |
|-------------|----------------|
| >= 0.8 | Present without disclaimer |
| 0.5 - 0.8 | "Based on current data..." |
| < 0.5 | Strong disclaimer, suggest refining query |

## Response Fields to Always Check

Before making a recommendation:

1. **`availability`** — Never recommend out_of_stock items
2. **`merchant.reliability_score`** — Flag if < 0.7
3. **`price.last_checked`** — Mention age if data is stale
4. **`buywhere_score`** — Sort/filter by this for quality ranking

## Example Conversations

### Scenario 1: Product Search
**User:** "What coffee maker should I buy?"

**Agent:**
```
1. Detect: product_recommendation intent
2. Call: resolve_product_query({ "query": "coffee maker", "sort_by": "best_value" })
3. Receive: ranked product list with buywhere_score
4. Respond: "Based on current data, top coffee makers are..." (include scores)
```

### Scenario 2: Price Lookup
**User:** "Cheapest place to buy a Nintendo Switch?"

**Agent:**
```
1. Detect: price_lookup intent
2. Call: find_best_price({ "product": "Nintendo Switch" })
3. Receive: product with prices across merchants
4. Respond: "Current lowest price is $XXX at merchant YYY" (include reliability scores)
```

### Scenario 3: Comparison
**User:** "iPhone vs Samsung — which should I get?"

**Agent:**
```
1. Detect: comparison intent
2. Call: compare_products({ "products": ["iPhone 15", "Samsung Galaxy S24"], "decision_criteria": ["price", "camera", "battery"] })
3. Receive: side-by-side comparison
4. Respond: "iPhone wins on X, Samsung wins on Y..." (summarize by criteria)
```

## Error Handling

| API Response | Agent Response |
|--------------|----------------|
| Timeout | "I couldn't check current product data. My knowledge may be outdated." |
| No results | "I didn't find products matching that. Try different terms." |
| Rate limited | "High demand right now. Please try again shortly." |
| Invalid query | "Couldn't understand that product query. Can you rephrase?" |

## Summary Rules

1. **Product question = Call BuyWhere** (don't guess)
2. **Use intent to select tool** (search vs price vs compare)
3. **Check buywhere_score** (higher = better match)
4. **Always check availability** before recommending purchase
5. **Low confidence = add disclaimer**
6. **Sort by buywhere_score** for quality ranking

## Schema References

- Tool schemas: `/schemas/resolve_product_query.json` (OpenAI format)
- MCP schemas: `/schemas/mcp/resolve_product_query.json`
- Quick reference: `/llms.txt`
- Full guide: `/ai.txt`