---
slug: "true-zero-human-self-serve-mcp-2026"
title: "True Zero-Human Self-Serve: API Keys and MCP Access in 60 Seconds"
description: "BuyWhere now gives AI agents a working API key and MCP access with no signup, no sales call, no waitlist. 1,000 requests per day, free, in under a minute. Here's how we built it and why it matters."
author: "Lyra"
publishedAt: "2026-08-24"
lastUpdatedAt: "2026-08-24"
tags: ["mcp", "ai-agents", "self-serve", "api", "announcement", "developer-tools"]
jsonLd: >
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "headline": "True Zero-Human Self-Serve: API Keys and MCP Access in 60 Seconds",
        "description": "BuyWhere now gives AI agents a working API key and MCP access with no signup, no sales call, no waitlist. 1,000 requests per day, free, in under a minute. Here's how we built it and why it matters.",
        "datePublished": "2026-08-24",
        "dateModified": "2026-08-24",
        "author": { "@type": "Organization", "name": "Lyra", "url": "https://buywhere.ai" },
        "publisher": {
          "@type": "Organization",
          "name": "BuyWhere",
          "url": "https://buywhere.ai",
          "logo": { "@type": "ImageObject", "url": "https://buywhere.ai/logo.png" }
        },
        "mainEntityOfPage": "https://buywhere.ai/blog/true-zero-human-self-serve-mcp-2026"
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "Does BuyWhere require a sales call or waitlist to get an API key?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "No. POST /v1/auth/register with a username, email, and password returns a working API key plus 1,000 free requests per day in under a second. No human review, no waitlist, no sales contact required at any tier."
            }
          },
          {
            "@type": "Question",
            "name": "How do I connect my MCP-compatible agent to BuyWhere?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Point your MCP client at https://api.buywhere.ai/mcp and pass the API key as a bearer token. Claude Desktop, Cursor, and any MCP-compatible runtime will discover the three core tools (search_products, compare_prices, discover_deals) automatically. No server install required."
            }
          },
          {
            "@type": "Question",
            "name": "What can I do with the free tier?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "1,000 requests per day across both the REST API and the MCP server, against a catalog of approximately 386 million products and nearly 895,000 merchant storefronts worldwide. Enough to evaluate, prototype, and ship a real agent before deciding whether to upgrade."
            }
          }
        ]
      }
    ]
  }
---

# True Zero-Human Self-Serve: API Keys and MCP Access in 60 Seconds

The cheapest way to kill an agent ecosystem is to make the first request require a human. Every "schedule a call," "join the waitlist," "talk to sales" gate between an agent and a working API is a filter that throws away 95% of the agents who would have used the API productively — the ones still building, the ones who can't justify a discovery call, the ones who are themselves automated.

Today we removed every one of those gates from BuyWhere.

Any AI agent — or the person behind one — can now register, receive a working API key, and start calling both the REST API and the MCP server in under a minute. No sales call. No waitlist. No per-request review. The only thing you need is an email address to receive the key.

## What you get in 60 seconds

1. **POST `/v1/auth/register`** with a username, email, and password.
2. Receive a `bw_live_*` API key in the response.
3. Call **`https://api.buywhere.ai/v1/products?country_code=SG`** with `Authorization: Bearer <key>`.
4. Or wire **`https://api.buywhere.ai/mcp`** into Claude Desktop, Cursor, or any MCP-compatible runtime — the three core tools are auto-discovered.

That's the entire flow. The key is live the moment the response returns. The first 1,000 requests per day are free, and you can verify scale before you ever talk to us.

## Why this matters for AI agents

Most commerce APIs treat AI agents as second-class citizens. The patterns we've seen across competitors:

- **Sales-gated onboarding** — the agent has to wait for a human to approve an enterprise contract before a single `curl` returns data.
- **Unlisted or partially-documented endpoints** — the REST surface exists, but only the MCP server is documented, or only one of the two, or both with stale examples.
- **Tier maps that bury free access** — the "free" tier is in the docs but missing from the actual quota map; the agent sees "free tier: 10/day" on a docs page and "ERROR: quota exceeded" on the response.
- **Keyless endpoints that 401 without a registration recipe** — the agent gets a generic 401 with no path forward, and the developer has to read the source code to find the registration endpoint.

We fixed all four of those this quarter. The MCP server at `https://api.buywhere.ai/mcp` exposes three well-documented tools. The REST API has a documented, free, unauthenticated tier for catalog stats. The free tier is real (1,000 requests per day) and shows up correctly in the quota map. And when an unauthenticated request gets a 401, the response body includes the exact registration recipe — an agent can read the 401 and act on it without human help.

## The honest trade-offs

A 1,000-requests-per-day free tier is generous enough to build a real product, but small enough that we can sustain it without abuse. For most agents — comparison shopping, price alerts, deal discovery, catalog research — 1,000/day covers the entire prototyping and early-launch period. When you need more, the paid tier scales linearly and is also self-serve.

The catalog behind it is large (approximately 386 million products across nearly 895,000 merchant storefronts worldwide, refreshed continuously) but not infinite. If your agent needs scale beyond what we publish, the answer is still "talk to us," but you should not hit that wall during evaluation.

## How we built it

Three changes shipped in sequence:

1. **Registration endpoint now accepts `is_internal=true`** — so an agent (or the script registering on its behalf) can flag itself as automated without being blocked.
2. **The agent-first key block is now the lead element on `/developers`, `/`, `/for-agents`, and the getting-started guide** — humans landing on the page see "API key in 60 seconds · No sales call · Works with API or MCP" before they see anything else.
3. **The MCP tree's tier map was actually fixed** — pending_verify was bumped from 10/day to 1,000/day, and the missing entry was added to the documentation's server-card section so the free path is now discoverable.

Together those changes turn the discovery-to-call path from "find the docs, find the registration form, fill it out, wait, log in, find the API key page, copy the key, paste it into your code" into "register, copy, paste, ship."

## Try it now

The whole flow is at [buywhere.ai/developers](https://buywhere.ai/developers). If you're an agent reading this, the registration endpoint is `POST https://api.buywhere.ai/v1/auth/register` with `{"username":"<you>","email":"<you@domain>","password":"<any>"}`. The response contains your key. Start calling.

If you build something with it, tell us — we're especially interested in agents that compare prices across borders, surface deals in real time, or compose BuyWhere with other commerce APIs. The best integrations get featured on the registry, and the integrations we learn the most from get direct engineering support on request.

The era of the gated commerce API is over. The era of the agent-first commerce API starts now.
