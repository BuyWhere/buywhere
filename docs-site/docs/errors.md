---
sidebar_position: 4
title: Error Reference
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

**How to handle:** Wait `retry_after` seconds before retrying. Use exponential backoff starting at 2 seconds. See [Authentication](/docs/authentication#exceeding-the-limit) for a retry code example.

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
