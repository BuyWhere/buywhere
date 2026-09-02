---
title: "Error Reference"
description: "All error responses follow this format:"
public: true
lastUpdated: "2026-08-24"
version: "1.1.0"
---

# Error Reference

All error responses follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description.",
    "doc_url": "https://buywhere.ai/docs/errors#ERROR_CODE"
  }
}
```

## Error Codes

### 400 — Bad Request

| Code | Description |
|------|-------------|
| `INVALID_PARAMETER` | A parameter has an invalid value. |
| `MISSING_REQUIRED_FIELD` | A required field is missing from the request. |
| `INVALID_QUERY` | The `q` query parameter is missing or empty. |
| `INVALID_MARKET` | The specified country code or region is not supported. |
| `INVALID_CATEGORY` | The category name or slug is not recognized. |
| `INVALID_PAGINATION` | Invalid `limit`, `offset`, or `page` value. |
| `INVALID_JSON` | The request body is not valid JSON. |

**Example:**

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "Query parameter is missing or empty.",
    "doc_url": "https://buywhere.ai/docs/errors#INVALID_QUERY"
  }
}
```

### 401 — Unauthorized

| Code | Description |
|------|-------------|
| `MISSING_API_KEY` | No API key was provided. Include `Authorization: Bearer <key>`. |
| `INVALID_API_KEY` | The API key does not exist or is malformed. |
| `REVOKED_API_KEY` | The API key has been revoked (e.g. after rotation). |

**Example:**

```json
{
  "error": {
    "code": "MISSING_API_KEY",
    "message": "API key is required. Pass as Authorization: Bearer <key>.",
    "doc_url": "https://buywhere.ai/docs/errors#MISSING_API_KEY"
  }
}
```

### 403 — Forbidden

| Code | Description |
|------|-------------|
| `INSUFFICIENT_SCOPE` | Your tier does not support this endpoint. Upgrade your plan. |
| `ENDPOINT_DISABLED` | This endpoint is temporarily disabled. |
| `FORBIDDEN` | Access denied. |

**Example:**

```json
{
  "error": {
    "code": "INSUFFICIENT_SCOPE",
    "message": "API key does not have the required scope for this endpoint.",
    "doc_url": "https://buywhere.ai/docs/errors#INSUFFICIENT_SCOPE"
  }
}
```

### 404 — Not Found

| Code | Description |
|------|-------------|
| `NOT_FOUND` | The requested resource (product, category, etc.) does not exist. |

### 405 — Method Not Allowed

| Code | Description |
|------|-------------|
| `METHOD_NOT_ALLOWED` | The HTTP method is not supported for this endpoint. |
| `ENDPOINT_DEPRECATED` | This endpoint has been deprecated. Check docs for the replacement. |

### 429 — Rate Limit Exceeded

| Code | Description |
|------|-------------|
| `RATE_LIMIT_EXCEEDED` | You have exceeded your tier's rate limit. |

The response includes retry information:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Per-minute rate limit exceeded.",
    "doc_url": "https://buywhere.ai/docs/errors#RATE_LIMIT_EXCEEDED"
  },
  "rate_limit": {
    "retry_after": 45,
    "limit": 60,
    "remaining": 0,
    "reset_at": "2026-05-16T14:45:00Z"
  }
}
```

**How to handle:** Wait `retry_after` seconds before retrying. Use exponential backoff starting at 2 seconds. See [Authentication](/authentication#exceeding-the-limit) for a retry code example.

### 422 — Validation Error

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | The request data failed validation. Check required fields and formats. |

### 500 — Internal Server Error

| Code | Description |
|------|-------------|
| `INTERNAL_ERROR` | An unexpected error occurred. Retry after a brief delay. |

### 502 — Bad Gateway

| Code | Description |
|------|-------------|
| `UPSTREAM_ERROR` | An upstream service failed. Retry after a brief delay. |

### 503 — Service Unavailable

| Code | Description |
|------|-------------|
| `SERVICE_UNAVAILABLE` | The service is temporarily unavailable. Retry after a brief delay. |

## HTTP Status Code Summary

| Status | Meaning | Action |
|--------|---------|--------|
| `200` | Success | Process the response |
| `400` | Bad request | Fix the request parameters |
| `401` | Authentication failed | Check your API key |
| `403` | Forbidden | Upgrade your tier or check permissions |
| `404` | Not found | Verify the resource ID |
| `405` | Method not allowed | Use the correct HTTP method |
| `429` | Rate limited | Back off and retry |
| `422` | Validation error | Check request body format |
| `500` | Server error | Retry with backoff |
| `502` | Upstream error | Retry with backoff |
| `503` | Unavailable | Retry with backoff |

## Empty-Result Envelope (`meta.emptiness_reason`)

When an MCP tool or REST API call returns `200 OK` with zero products, the response includes an `emptiness_reason` field in the `meta` object. This tells agents *why* the result is empty, so they can decide whether to retry, widen the query, or surface an error to the user.

> **Note (BUY-80190 / BUY-71539 residual, 2026-09-02):** Non-empty responses MUST NOT carry `emptiness_reason` when the response is **clean** (`meta.degraded` is `false` or absent). The field is required only on:
> - empty responses (P2.6 base contract), OR
> - non-empty responses when `meta.degraded=true` (timeout / partial-fail / REST fallback / circuit_open).
>
> Agents branching on data quality should check `meta.degraded === true` (or `meta.status === 'degraded'`) FIRST and trust the emptiness_reason when it appears on a non-empty payload — it means the results came from a degraded path and may be partial.

### Enum values

| `emptiness_reason` | When it fires | Agent action |
|---|---|---|
| `no_data` | The region has zero products indexed in the catalog. | Treat as authoritative. Do not retry — the catalog genuinely has nothing for this region. |
| `no_match` | The region has products, but the query terms or filters excluded all of them. | Widen the query or drop filters. Do not retry the same query. |
| `api_error` | A downstream service (DB, vector store, Redis) raised an error, and the engine fell back to returning empty. | Retry once with a short backoff (≤2s). If still empty, surface as ambiguous to the user. |
| `quota` | The orchestrator rate-limit guardrail triggered before the engine could process the query. | Wait for the rate-limit window to reset. Do not retry-storm. |
| `region_unsupported` | The requested country code is not in the supported set (`SG`, `US`, `MY`, `TH`, `VN`, `PH`, `ID`). | Re-issue the query with a supported region. |
| `category_unsupported` | The requested category slug is unknown or under taxonomy transition. | Drop the category filter or consult `/v1/categories` for valid names. |
| `deliver_to_missing` | You omitted `deliver_to` (or `country_code`/`country`), but the catalog has matching products for other regions. | Re-issue with `deliver_to` set to the buyer's country. |
| `invalid_deliver_to` (MCP v2 only) | You passed a `deliver_to` that is not a supported ISO 3166-1 alpha-2 code. | Use a supported code from the `hint` field. |

### `confidence` field

Every `emptiness_reason` comes with a `confidence` field:

| `confidence` | Meaning | Agent behavior |
|---|---|---|
| `high` | The engine is confident in the classification. Detection heuristics fired cleanly with no ambiguity. | Treat the reason as authoritative. Do not retry. |
| `low` | The engine could not definitively classify the cause (e.g., ambiguous replica state, thin catalog, recent SEV-1). | Apply fallback: retry once after a short backoff. If still empty, surface as ambiguous to the user. |

### `diagnostic` block

When `emptiness_reason` is present, `meta.diagnostic` provides additional context:

```json
{
  "meta": {
    "emptiness_reason": "no_match",
    "confidence": "high",
    "diagnostic": {
      "engine_status": "ok",
      "indexed_for_region": true,
      "category_recognized": true,
      "rate_limit_remaining": null,
      "deliver_to_present": true
    }
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `engine_status` | `ok` \| `degraded` \| `error` | Overall engine health at query time. |
| `indexed_for_region` | `boolean` | Whether the requested region is in the supported regions list. |
| `category_recognized` | `boolean` | Whether the requested category was matched in the taxonomy. |
| `rate_limit_remaining` | `integer \| null` | Quota remaining for your tier (null if not rate-limited). |
| `deliver_to_present` | `boolean` | Whether ANY of `deliver_to`/`country_code`/`country` was passed. Critical for diagnosing `deliver_to_missing`. |

### Worked examples

#### REST API (empty query)

```bash
curl -s "https://api.buywhere.ai/v1/products/search?q=zzzz_notfound&country_code=US&limit=2" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

Response:

```json
{
  "data": [],
  "meta": {
    "total": 0,
    "emptiness_reason": "no_match",
    "confidence": "high",
    "diagnostic": {
      "engine_status": "ok",
      "indexed_for_region": true,
      "category_recognized": false,
      "rate_limit_remaining": null,
      "deliver_to_present": true
    }
  }
}
```

#### MCP v2 (invalid deliver_to)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_products_v2",
    "arguments": {
      "q": "laptop",
      "deliver_to": "ZZ",
      "limit": 5
    }
  }
}
```

Response (note: NOT a JSON-RPC error, a 200 OK with empty results):

```json
{
  "data": [],
  "meta": {
    "emptiness_reason": "invalid_deliver_to",
    "hint": "deliver_to=\"ZZ\" is not a supported country code. Supported: SG, US, VN, TH, MY, GB, IN, AU, PH, ID.",
    "deliver_to": "ZZ"
  }
}
```

### For agents

- **Always check for `meta.emptiness_reason`** when the response array is empty.
- **When `confidence: low`**: retry once with a backoff ≤2s, then treat as ambiguous.
- **When `deliver_to_missing`**: re-issue with the buyer's actual region.
- **When `quota`**: respect the rate-limit window; do not storm retries.
- **When `api_error`**: log the event and surface to the user as a transient failure.

See also: [Agent-DX v2 Wire Reference](/agent-dx) for the full tool surface.
