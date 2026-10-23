---
title: "Discovery"
description: "How agents find BuyWhere — Agent Card, llms.txt, signed origin, and the X-Agent-* response header namespace."
public: true
---

# Discovery

BuyWhere exposes a small, deterministic discovery surface so AI agents can locate the API, prove its origin, and self-register a key in a single round-trip. This page describes that surface and the response headers that advertise it.

For the canonical contract (header values, hard rules, per-header semantics), see [`docs/P2.3-headers-spec.md`](/docs/P2.3-headers-spec). This page is the operator-facing reference; the spec doc is the source of truth.

## Response Headers (P2.3)

Every response from `https://buywhere.ai/*` and `https://api.buywhere.ai/*` carries a small set of `X-Agent-*` headers that advertise the discovery surface. CORS exposes all of them so browser-based agents can read them.

| Header | When emitted | Value |
|---|---|---|
| `X-Agent-Protocol` | every response | `buywhere/v1` |
| `X-Agent-Card` | every response | `https://api.buywhere.ai/.well-known/agent.json` |
| `X-LLMs-Txt` | every response | `https://api.buywhere.ai/llms.txt` |
| `X-Agent-Index` | 200 catalog responses only | `https://api.buywhere.ai/v1/products?q={q}&country_code={cc}` |
| `X-Agent-Auth` | 401 and 403 responses only | `Bearer; register=https://buywhere.ai/api-keys` |

Plus the CORS directive:

```
Access-Control-Expose-Headers: X-Agent-Protocol, X-Agent-Card, X-LLMs-Txt, X-Agent-Index, X-Agent-Auth
```

### Per-header behaviour

**`X-Agent-Protocol: buywhere/v1`** — present on every response, including 5xx. The version sentinel: agents should refuse to parse the rest of the `X-Agent-*` namespace if this header is absent or unrecognized.

**`X-Agent-Card`** — points at the [signed Agent Card](#agent-card). Always present.

**`X-LLMs-Txt`** — points at the [llms.txt manifest](#llms-txt). Always present.

**`X-Agent-Index`** — only on 200 responses from catalog endpoints (`/v1/products/search`, `/v1/products/compare`, `/v1/products/{id}`, `/v1/p/{id}` (PDP alias), `/v1/categories`, `/v1/deals`). The value is a templated URL with `{q}` and `{cc}` placeholders; agents substitute them client-side using the request they just sent.

**`X-Agent-Auth`** — only on `401 Unauthorized` and `403 Forbidden`. The value `Bearer; register=https://buywhere.ai/api-keys` tells agents the auth scheme is `Bearer` and where to register a key. Not emitted on `429` (rate-limit responses already carry `Retry-After` and `X-RateLimit-*`).

### CORS

`Access-Control-Expose-Headers` lists exactly the five header names above — no wildcards, no extras. This is a hard requirement: without it, browser-based agents cannot read the `X-Agent-*` namespace at all.

### Quick verification

```bash
# Every response carries X-Agent-Protocol
curl -sI https://buywhere.ai/ | grep -i '^x-agent-protocol'
curl -sI https://api.buywhere.ai/ | grep -i '^x-agent-protocol'

# Catalog endpoint exposes all five
curl -sI 'https://api.buywhere.ai/v1/products/search?q=laptop&country_code=US' \
  -H 'Authorization: Bearer bw_test_xxx' \
  -H 'Origin: https://buywhere.ai' \
  | grep -iE '^x-agent|^access-control-expose-headers'

# 401 carries X-Agent-Auth, NOT X-Agent-Index
curl -sI 'https://api.buywhere.ai/v1/products/search?q=laptop' \
  | grep -i '^x-agent'
```

## Agent Card

A signed JSON document at `https://api.buywhere.ai/.well-known/agent.json` that proves the BuyWhere origin and lists the public capabilities of the API.

```
GET /.well-known/agent.json
```

- **Content-Type:** `application/json; charset=utf-8`
- **Integrity:** JWS-signed (P2.4). Fetchers should verify the signature against the pinned public key before trusting the document.
- **Cache:** `Cache-Control: public, max-age=86400` (24h).

The Agent Card describes:

- API surface (endpoints, auth schemes, rate limits).
- Supported countries and regions.
- Discovery URLs (`llms.txt`, OpenAPI, MCP server manifest).
- Contact and policy information.

## llms.txt

A `text/plain` manifest at `https://api.buywhere.ai/llms.txt` describing the BuyWhere surface in a format LLM agents can ingest directly. The format follows the [`llms.txt` proposal](https://llmstxt.org).

```
GET /llms.txt
```

- **Content-Type:** `text/plain; charset=utf-8`
- **Cache:** `Cache-Control: public, max-age=86400` (24h).

Use this when you need a single human-readable summary of what BuyWhere does and how to call it — it is the shortest path from "what is this?" to "first request works."

## OpenAPI

```
GET /openapi.json
```

The full OpenAPI 3.1 schema for the BuyWhere REST API. Linked from the root response via `Link: </openapi.json>; rel="describedby"`.

## API Catalog

```
GET /.well-known/api-catalog
```

A machine-readable list of all BuyWhere surfaces (REST, MCP, web). Linked from the root response via `Link: </.well-known/api-catalog>; rel="api-catalog"`.

## MCP Server Manifest

```
GET /.well-known/mcp.json
```

The MCP server manifest for clients that discover MCP servers via the `.well-known/mcp.json` convention. Linked from the root response via `Link: </.well-known/mcp.json>; rel="mcp-server-manifest"`.

## Rate Limit Headers (existing)

All responses also include the standard rate-limit headers (independent of the P2.3 `X-Agent-*` namespace):

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Tier's per-minute cap |
| `X-RateLimit-Remaining` | Requests left in the current window |
| `X-RateLimit-Reset` | Epoch timestamp when the window resets |

See [Authentication](/docs/authentication#rate-limit-headers) for full details.

## See also

- [Authentication](/docs/authentication) — API key usage and rate-limit headers
- [P2.3 Headers Spec](/docs/P2.3-headers-spec) — canonical header contract
- [Agent Developer Experience](/docs/agent-dx) — how agents find and onboard to BuyWhere
- [Search Products](/docs/api-reference/search) — primary catalog endpoint