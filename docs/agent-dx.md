---
title: "Agent Developer Experience"
description: "How AI agents find, verify, and onboard to BuyWhere — the discovery trip from a single curl to a working API call."
public: true
---

# Agent Developer Experience

BuyWhere is built agent-first. This page describes the trip an AI agent takes from "I just learned BuyWhere exists" to "I am making signed, authenticated requests against the live catalog." If you are wiring an agent to BuyWhere, read this first.

## How agents find us

There are two equivalent entry surfaces. Pick whichever you hit first.

### Entry surface 1 — `https://buywhere.ai/`

The marketing + documentation root. A browser or a headless fetch gets back the homepage plus the full `X-Agent-*` namespace (see [Discoverability headers](#discoverability-headers-p23)). Follow the headers from here.

### Entry surface 2 — `https://api.buywhere.ai/`

The API root. A bare `curl -sI https://api.buywhere.ai/` returns the same `X-Agent-*` namespace plus `Link` headers pointing at the OpenAPI schema, the MCP server manifest, and the API catalog.

Both surfaces are first-class. Either one is a valid starting point for the discovery trip.

## Discoverability headers (P2.3)

Every response from both surfaces carries the `X-Agent-*` namespace. CORS exposes all five so browser-based agents can read them.

| Header | When | Value |
|---|---|---|
| `X-Agent-Protocol` | every response | `buywhere/v1` |
| `X-Agent-Card` | every response | `https://api.buywhere.ai/.well-known/agent.json` |
| `X-LLMs-Txt` | every response | `https://api.buywhere.ai/llms.txt` |
| `X-Agent-Index` | 200 catalog only | `https://api.buywhere.ai/v1/products?q={q}&country_code={cc}` |
| `X-Agent-Auth` | 401/403 only | `Bearer; register=https://buywhere.ai/api-keys` |

Plus the CORS directive:

```
Access-Control-Expose-Headers: X-Agent-Protocol, X-Agent-Card, X-LLMs-Txt, X-Agent-Index, X-Agent-Auth
```

Canonical contract, per-header semantics, and hard rules: see the [P2.3 Headers Spec](/docs/P2.3-headers-spec). This page shows how to use them.

### The discovery trip

A well-behaved agent follows this five-step loop on its first hit to BuyWhere. Every step is a single HTTP request.

**1. Probe `X-Agent-Protocol`.**

```
curl -sI https://api.buywhere.ai/ | grep -i '^x-agent-protocol'
```

Expect: `x-agent-protocol: buywhere/v1`. If this is missing or unrecognized, refuse to parse the rest of the namespace (forward-compatibility sentinel).

**2. Fetch `X-Agent-Card` (signed Agent Card).**

```
curl -s https://api.buywhere.ai/.well-known/agent.json
```

Returns a JWS-signed JSON document proving the BuyWhere origin. Verify the signature against BuyWhere's pinned public key before trusting any of its claims (capabilities, rate limits, supported countries). Pin the key once; rotate only when the Agent Card itself announces a rotation.

**3. Fetch `X-LLMs-Txt` (llms.txt manifest).**

```
curl -s https://api.buywhere.ai/llms.txt
```

Returns a `text/plain` summary of the BuyWhere surface in the [llms.txt](https://llmstxt.org) format. Read this when you need a single human-readable overview of what BuyWhere does and how to call it — it is the shortest path from "what is this?" to "first request works."

**4. For catalog calls, parse `X-Agent-Index`.**

After any 200 response from a catalog endpoint (`/v1/products/search`, `/v1/products/compare`, `/v1/products/{id}`, `/v1/categories`, `/v1/deals`), read `X-Agent-Index`:

```
x-agent-index: https://api.buywhere.ai/v1/products?q={q}&country_code={cc}
```

Substitute `{q}` with your original query string (URL-encoded) and `{cc}` with the two-letter country code you resolved (`SG`, `US`, etc.). The templated URL tells you the canonical search form for this surface.

**5. On 401 or 403, follow `X-Agent-Auth`.**

```
x-agent-auth: Bearer; register=https://buywhere.ai/api-keys
```

The header value tells you (a) the auth scheme is `Bearer`, and (b) where to register a new key. Hit the register URL, get a `bw_live_...` key, and retry. Do not retry on `429` — that header carries `Retry-After` and `X-RateLimit-*` instead.

### Quick Python example

```python
import httpx

API = "https://api.buywhere.ai"

# Step 1: probe the namespace
root = httpx.head(API)
proto = root.headers.get("x-agent-protocol")
assert proto == "buywhere/v1", f"unexpected protocol: {proto!r}"

# Step 2: fetch the signed Agent Card (verify JWS in production)
card = httpx.get(f"{API}/.well-known/agent.json").json()

# Step 3: read the llms.txt manifest
manifest = httpx.get(f"{API}/llms.txt").text

# Step 4: catalog call (no key — expect 401 + X-Agent-Auth)
resp = httpx.get(f"{API}/v1/products/search", params={"q": "laptop", "country_code": "US"})
if resp.status_code in (401, 403):
    auth_hint = resp.headers["x-agent-auth"]
    # "Bearer; register=https://buywhere.ai/api-keys"
    print("register at:", auth_hint.split("register=")[1])

# Register, then retry with the key
api_key = "<registered bw_live_... key>"
resp = httpx.get(
    f"{API}/v1/products/search",
    params={"q": "laptop", "country_code": "US"},
    headers={"Authorization": f"Bearer {api_key}"},
)
print("catalog response:", resp.status_code)
# After 200: read X-Agent-Index, substitute {q}/{cc}, cache the canonical form
canonical_index = resp.headers["x-agent-index"].replace("{q}", "laptop").replace("{cc}", "US")
```

## Onboarding

1. **Register a key.** `POST /v1/auth/register` with `agent_name`, `email`, `use_case`. The response includes your API key — save it, it is shown only once. New keys start as `unverified` (5 req/min, 50/day).
2. **Verify your email.** Click the link in the registration email to upgrade to the `free` tier (60 req/min, 1,000/day).
3. **Make your first call.** `GET /v1/products/search?q=...&country_code=SG` with `Authorization: Bearer bw_live_...`.
4. **Upgrade if needed.** [Contact sales](https://buywhere.ai/contact) for Pro (300/min, 10K/day) or Enterprise (1K/min, 100K/day) tiers.

See [Getting Started](/docs/getting-started) for the full registration flow with curl, Python, and Node.js examples.

## What to send with every request

| Header | Required | Notes |
|---|---|---|
| `Authorization` | yes | `Bearer bw_live_...` |
| `User-Agent` | recommended | Identify your agent (`my-agent/0.4.2`). BuyWhere logs this and may rate-limit unidentified clients. |
| `Accept` | optional | Defaults to `application/json`. Use `Accept: text/markdown` for the OpenAPI-as-markdown response. |

## What to expect back

Every response includes:

- The body (JSON, except `/llms.txt` which is `text/plain`).
- The `X-Agent-*` namespace (P2.3, above).
- The `X-RateLimit-*` namespace ([Authentication → Rate Limit Headers](/docs/authentication#rate-limit-headers)).
- Standard `Content-Type`, `Cache-Control`, and `Link` headers.

Errors follow the [Errors reference](/docs/errors) format: `{ "error": { "code": "...", "message": "...", "doc_url": "..." } }`.

## Cross-references

- [P2.3 Headers Spec](/docs/P2.3-headers-spec) — canonical `X-Agent-*` contract
- [Discovery API Reference](/docs/api-reference/discovery) — endpoint reference for the discovery surface
- [Authentication](/docs/authentication) — keys, rate limits, rotating keys
- [Getting Started](/docs/getting-started) — first-call walkthrough
- [Errors](/docs/errors) — error code reference