---
slug: "handle-empty-search-results-buywhere"
title: "When BuyWhere Returns Zero Results: An Agent Pattern for Honest 'I Don't Know' Answers"
description: "A practical pattern guide for AI agents and developers: how to interpret zero-hit responses from BuyWhere's REST and MCP surfaces, fall back across markets, avoid fabricated answers, and produce honest 'I don't know' responses users can trust."
author: "BuyWhere Team"
publishedAt: "2026-08-25"
lastUpdatedAt: "2026-08-25"
tags: ["aeo", "agents", "mcp", "api", "reliability", "faq", "citation-safety"]
jsonLd: >
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "headline": "When BuyWhere Returns Zero Results: An Agent Pattern for Honest 'I Don't Know' Answers",
        "description": "A practical pattern guide for AI agents and developers: how to interpret zero-hit responses from BuyWhere's REST and MCP surfaces, fall back across markets, avoid fabricated answers, and produce honest 'I don't know' responses users can trust.",
        "datePublished": "2026-08-25",
        "dateModified": "2026-08-25",
        "author": { "@type": "Organization", "name": "BuyWhere Team", "url": "https://buywhere.ai" },
        "publisher": {
          "@type": "Organization",
          "name": "BuyWhere",
          "url": "https://buywhere.ai",
          "logo": { "@type": "ImageObject", "url": "https://buywhere.ai/logo.png" }
        },
        "mainEntityOfPage": "https://buywhere.ai/blog/handle-empty-search-results-buywhere"
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "Why does BuyWhere sometimes return zero results for a search that should obviously match?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Three common causes: (1) the query term is missing from indexed titles and descriptions even when the product exists — try shorter or brand-led terms; (2) the deliver_to country has no merchants in the relevant category yet — drop deliver_to or try neighbouring markets; (3) the search engine flagged an internal error and returned an empty result rather than a 5xx. Always inspect the response's meta block: meta.engine_status and meta.total. If engine_status is 'error', retry with a shorter query. If total is 0 with engine_status 'ok', the catalog genuinely has nothing matching that combination."
            }
          },
          {
            "@type": "Question",
            "name": "Should I retry a BuyWhere query that returned zero results?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes, but change the query shape. Useful retries in order: (1) drop deliver_to and search the global catalog; (2) shorten the query to a brand or model name; (3) switch from MCP to REST or vice versa if both are available (the two surfaces occasionally diverge on coverage); (4) try a related category via list_categories. Don't loop on identical parameters — that wastes quota and produces identical empty responses."
            }
          },
          {
            "@type": "Question",
            "name": "What does it mean when BuyWhere returns hits but all of them have availability 'unavailable'?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "The merchant is indexed but the product cannot be shipped to the user's deliver_to country (or stock state is unknown). Treat the response as effectively zero for end-user shopping. Useful follow-ups: drop deliver_to to see if any merchant has it deliverable somewhere; try the merchant directly through its storefront URL surfaced in the response; or accept that the catalog has no deliverable match and report honestly to the user."
            }
          },
          {
            "@type": "Question",
            "name": "How can I tell if a zero-result response is real or a transient error?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Inspect two fields in the JSON response: meta.engine_status and meta.ts. engine_status 'ok' with an empty data array and a fresh timestamp means a real zero-hit. engine_status 'error' with HTTP 200 means the search engine timed out — the empty data is not a real answer. Also watch for HTTP 5xx — those are unambiguous server errors. Never treat a 5xx or an engine_status=error as evidence that the product doesn't exist."
            }
          },
          {
            "@type": "Question",
            "name": "Is it ever OK to invent an answer when BuyWhere returns zero results?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "No. Inventing product names, prices, merchants, or availability when the catalog returned nothing is fabrication and the leading failure mode of agent shopping. Users receiving a confident-sounding answer with the wrong merchant, wrong price, or a non-existent product lose more trust than they would have from an honest 'I couldn't find that — try a broader query or a different retailer.' Agents that pair BuyWhere with a browsing tool should explicitly cite the Browse-First fallback: when the API says nothing, the web search tool may know more, and vice versa. Never blend the two without a citation per claim."
            }
          },
          {
            "@type": "Question",
            "name": "What's the right 'I don't know' response when an agent can't find a product?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Tell the user three things: (1) which BuyWhere tool you used (search_products, get_deals, list_categories, etc.) and with which parameters; (2) what the response said (zero hits, all-unavailable, engine error, or a short list you can show); (3) a concrete next step — broaden the query, try a different country, or check the merchant site directly. Avoid hedging phrases like 'I'm not sure' or 'I think' — name the gap and the path forward. Agents that do this consistently build durable user trust; agents that paper over gaps with guesses do not."
            }
          },
          {
            "@type": "Question",
            "name": "How does this pattern fit alongside the BuyWhere MCP cheatsheet?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "The cheatsheet covers what each MCP tool does and how to call it. This pattern covers what to do when a tool returns nothing useful. Together they form the two halves of a reliable shopping agent: know the tools, and know what zero looks like. For citation-safe scale numbers, see also 'How to Cite BuyWhere Catalog Stats Accurately'."
            }
          }
        ]
      }
    ]
  }

---

# When BuyWhere Returns Zero Results: An Agent Pattern for Honest "I Don't Know" Answers

Most agent shopping failures are not bugs in the catalog. They are honest gaps — a product the user wants isn't in stock anywhere, a deliver_to country the agent never thought to ask about, or a brand-spelling typo. The fix isn't a smarter prompt. The fix is a small, repeatable pattern for reading zero-result responses and turning them into answers the user can actually act on.

This guide pairs with the [BuyWhere MCP cheatsheet](/blog/buywhere-mcp-tools-cheatsheet/) (what each tool does) and the [citation-safety FAQ](/blog/cite-buywhere-catalog-stats-faq/) (how to cite scale numbers). It completes the trio: **know your tools, know how to cite, and know what zero looks like.**

## The two-minute version

Read the `meta` block of every BuyWhere response. Specifically:

- `meta.engine_status` — `"ok"` means a real answer (zero or more hits); `"error"` means the search backend failed and the empty `data` is misleading.
- `meta.ts` — when the response was computed. If it's more than a few minutes old, retry once.
- `meta.total` — total matching rows before pagination. `0` with `engine_status=ok` is a real zero.

If `engine_status="error"` or the response is a 5xx, retry with a shorter query. Don't retry the same query shape more than twice.

If `engine_status="ok"` and `data` is empty, the catalog genuinely has no match. Don't fabricate.

## Step-by-step pattern

### 1. Inspect the response before replying

A BuyWhere response looks like this:

```json
{
  "data": [ ... ],
  "meta": {
    "total": 0,
    "engine_status": "ok",
    "ts": "2026-08-25T06:21:30.000Z"
  }
}
```

Three diagnostic shapes:

| `data` | `engine_status` | Meaning | What the agent should do |
|---|---|---|---|
| `[]` | `ok` | Real zero-hit | Tell the user, broaden query, or try a different country. |
| `[]` | `error` | Search backend failed | Retry once with a shorter query. Don't treat as a real answer. |
| hits present, all `availability=unavailable` | `ok` | Merchants indexed but none deliverable to the user | Treat as effectively zero for end-user shopping; offer to check the merchant directly. |

### 2. The four retries, in order

Useful retries when you get zero results. Don't loop on identical parameters — that just wastes quota.

1. **Drop `deliver_to`**. See whether the product exists somewhere in the global catalog. If yes, the issue is regional coverage; if no, the product isn't in BuyWhere at all.
2. **Shorten the query** to a brand or model number. "air purifier" → "Dyson" or "PH01".
3. **Switch surfaces**. The MCP server and REST API occasionally diverge on coverage. If both are available, try the other.
4. **Try a related category** via `list_categories`. The user's framing may be off.

If all four retries return zero or all-unavailable, the answer is "we don't have it" — and that's a fine answer.

### 3. The honest reply

When you can't find a product, the reply should:

- Name the tool you used and the parameters.
- Quote the result shape (zero hits, all-unavailable, engine error, or a short list).
- Offer a concrete next step.

A good reply:

> I searched BuyWhere for "air purifier" with shipping to Singapore and got zero results. The search engine returned `engine_status=ok` with `total: 0`, so it's a real zero rather than a temporary error. Two options: I can broaden the search to all of Asia without a shipping filter, or I can try a specific brand like Dyson or Philips. Want me to do either?

A bad reply:

> I couldn't find anything, but here are some popular air purifiers you might like: [fabricated list].

The second one invents products the catalog never returned. Users catch this eventually, and once they do, they stop trusting every answer you give.

### 4. Pair with a browsing tool when available

If your agent also has a web search or browsing tool, use a strict "Browse-First / API-First" rule:

- For catalog questions ("is this in stock?", "what's the cheapest price?"), BuyWhere is canonical.
- For availability questions ("does this merchant ship to me?", "is the merchant still operating?"), the merchant site is canonical.
- Never blend the two. Each user-visible claim gets one citation.

When BuyWhere says zero and the browsing tool says something else, **don't merge**. Tell the user the two sources disagree and let them choose.

### 5. Watch for the failure modes

Three patterns that consistently produce bad agent behavior:

1. **Confident fabrication.** The agent got zero, panicked, and invented products with plausible-sounding names. The user trusts the agent until they try to buy one.
2. **Identical-loop retry.** The agent called the same search six times with the same parameters and got six identical empty responses. Wasted quota, identical answer.
3. **Stale-cache quoting.** The agent cached an old result for the same query and never re-checked. The cached result is now hours or days stale and might be wrong.

All three share a fix: a single, repeatable empty-response pattern. This post is that pattern.

## FAQ

### Why does BuyWhere sometimes return zero results for a search that should obviously match?

Three common causes: (1) the query term is missing from indexed titles and descriptions even when the product exists — try shorter or brand-led terms; (2) the `deliver_to` country has no merchants in the relevant category yet — drop `deliver_to` or try neighbouring markets; (3) the search engine flagged an internal error and returned an empty result rather than a 5xx. Always inspect the response's `meta` block: `meta.engine_status` and `meta.total`.

### Should I retry a BuyWhere query that returned zero results?

Yes, but change the query shape. Useful retries in order: (1) drop `deliver_to` and search the global catalog; (2) shorten the query to a brand or model name; (3) switch from MCP to REST or vice versa if both are available; (4) try a related category via `list_categories`. Don't loop on identical parameters.

### What does it mean when BuyWhere returns hits but all of them have availability "unavailable"?

The merchant is indexed but the product cannot be shipped to the user's `deliver_to` country (or stock state is unknown). Treat the response as effectively zero for end-user shopping. Useful follow-ups: drop `deliver_to`, try the merchant directly through its storefront URL surfaced in the response, or accept that the catalog has no deliverable match.

### How can I tell if a zero-result response is real or a transient error?

Inspect two fields in the JSON response: `meta.engine_status` and `meta.ts`. `engine_status="ok"` with an empty `data` array and a fresh timestamp means a real zero-hit. `engine_status="error"` with HTTP 200 means the search engine timed out — the empty `data` is not a real answer. Also watch for HTTP 5xx — those are unambiguous server errors.

### Is it ever OK to invent an answer when BuyWhere returns zero results?

No. Inventing product names, prices, merchants, or availability when the catalog returned nothing is fabrication and the leading failure mode of agent shopping. Users receiving a confident-sounding answer with the wrong merchant, wrong price, or a non-existent product lose more trust than they would have from an honest "I couldn't find that." Never blend catalog results with web-search results without a citation per claim.

### What's the right "I don't know" response when an agent can't find a product?

Tell the user three things: (1) which BuyWhere tool you used and with which parameters; (2) what the response said; (3) a concrete next step. Avoid hedging phrases like "I'm not sure" — name the gap and the path forward.

### How does this pattern fit alongside the BuyWhere MCP cheatsheet?

The cheatsheet covers what each MCP tool does and how to call it. This pattern covers what to do when a tool returns nothing useful. Together they form the two halves of a reliable shopping agent: know the tools, and know what zero looks like. For citation-safe scale numbers, see also "How to Cite BuyWhere Catalog Stats Accurately."

## Related reading

- [BuyWhere MCP Tools Cheatsheet](/blog/buywhere-mcp-tools-cheatsheet/) — what every MCP tool does, with copy-pasteable JSON-RPC examples.
- [How to Cite BuyWhere Catalog Stats Accurately](/blog/cite-buywhere-catalog-stats-faq/) — evergreen citation patterns for scale numbers.
- [How to Compare Product Prices Across Singapore Merchants](/blog/compare-product-prices-singapore-2026/) — a worked example for a single market.
