---
title: "Authentication"
description: "All BuyWhere API endpoints require authentication via an API key."
public: true
---

All BuyWhere API endpoints require authentication via an API key.

## Using Your API Key

Include your API key in the `Authorization` header with the `Bearer` prefix:

```bash
curl "https://api.buywhere.ai/v1/products/search?q=laptop" \
  -H "Authorization: Bearer bw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### Alternative Methods

**ApiKey header** (for systems that conflict with Bearer tokens):

```bash
curl "https://api.buywhere.ai/v1/products/search?q=laptop" \
  -H "Authorization: ApiKey bw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**Query parameter** (not recommended for production — keys may appear in server logs):

```
GET /v1/products/search?q=laptop&api_key=bw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Rate Limits

Rate limits depend on your pricing tier:

| Tier | Requests/min | Requests/day | Access |
|------|-------------|-------------|--------|
| Unverified | 5 | 50 | Register (instant) |
| Free | 60 | 1,000 | Verify email |
| Pro | 300 | 10,000 | [Contact sales](https://buywhere.ai/contact) |
| Enterprise | 1,000 | 100,000 | [Contact sales](https://buywhere.ai/contact) |

### Rate Limit Headers

Every response includes rate limit information:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Your tier's per-minute cap |
| `X-RateLimit-Remaining` | Requests left in the current window |
| `X-RateLimit-Reset` | Epoch timestamp when the window resets |

### Exceeding the Limit

When you exceed your rate limit, the API returns a `429` response:

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

**Recommended retry strategy:** Back off exponentially starting at 2 seconds. Use the `retry_after` field (seconds) or `reset_at` timestamp to determine when to retry.

```python
import time
import httpx

def search_with_retry(query, max_retries=3):
    for attempt in range(max_retries):
        resp = httpx.get(
            "https://api.buywhere.ai/v1/products/search",
            params={"q": query},
            headers={"Authorization": "Bearer bw_live_xxx"},
        )
        if resp.status_code == 429:
            retry_after = resp.json().get("rate_limit", {}).get("retry_after", 2 ** attempt)
            time.sleep(retry_after)
            continue
        return resp.json()
    raise Exception("Rate limit exceeded after retries")
```

## Upgrading Your Tier

- **Unverified → Free**: Verify the email address you registered with.
- **Free → Pro**: Visit [buywhere.ai/contact](https://buywhere.ai/contact) or email sales@buywhere.ai.
- **Pro → Enterprise**: Contact sales for custom limits and SLA.

## Rotating Your API Key

Rotate your key at any time. The old key is invalidated immediately.

```bash
curl -X POST "https://api.buywhere.ai/v1/keys/rotate" \
  -H "Authorization: Bearer bw_live_current_key"
```

```json
{
  "api_key": "bw_live_new_key_here",
  "message": "Previous key has been revoked."
}
```

## Security Best Practices

- Never commit API keys to source control. Use environment variables.
- Use the `Authorization: Bearer` header, not query parameters.
- Rotate keys regularly and immediately if compromised.
- Use the minimum tier that meets your needs.
