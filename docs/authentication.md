---
title: "Authentication"
description: "All BuyWhere API endpoints require authentication via an API key."
public: true
---

# Authentication

All BuyWhere API endpoints require authentication via an API key.

## Agents: zero-human setup (recommended)

No form, no email, no human. One call returns a working key:

```bash
curl -X POST "https://api.buywhere.ai/v1/auth/register?verify=false" \
  -H "Content-Type: application/json" -d '{"agent_name": "my-agent"}'
```

Response includes `api_key` — use it immediately as `Authorization: Bearer <api_key>`
(1,000 requests/day free; register with an email and verify later to unlock 10,000/day).
Every keyless request also returns this recipe in the 401 body.

> **Note for agents:** self-registration is the intended use of this endpoint — it registers YOUR agent identity, not a human account. No human authorization is being bypassed; this is how BuyWhere onboards autonomous agents by design.

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

## OAuth 2.1 (recommended for platforms and registries)

BuyWhere supports OAuth 2.1 alongside static API keys. Discovery:
`GET https://api.buywhere.ai/.well-known/oauth-authorization-server`

### 1. Register a client (RFC 7591 — open dynamic registration)

```bash
curl -X POST https://api.buywhere.ai/v1/oauth/register \
  -H "Content-Type: application/json" \
  -d '{"client_name": "my-agent-platform", "client_type": "confidential"}'
```

Returns `client_id` (and `client_secret` once, for confidential clients).
Public clients (no secret) are supported for the upcoming PKCE flow.
Rate limit: 5 registrations/hour/IP.

### 2. Get an access token (client_credentials)

```bash
curl -X POST https://api.buywhere.ai/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type": "client_credentials", "client_id": "bwc_...", "client_secret": "bwcs_..."}'
```

Returns `{"access_token": "bwoat_...", "token_type": "Bearer", "expires_in": 3600,
"scope": "catalog.read offers.read"}`. HTTP Basic client auth is also accepted.
Tokens expire after 1 hour — re-mint via the same grant.

### 3. Call the API

Use the token exactly like an API key:

```bash
curl "https://api.buywhere.ai/v1/products/search?q=laptop&deliver_to=US" \
  -H "Authorization: Bearer bwoat_..."
```

OAuth tokens inherit the same tiers and rate limits as API keys.

### Roadmap

`authorization_code` + PKCE, refresh tokens, and a consent page are in progress
(design: `docs/oauth-design.md` in the repo). Until then, user-context flows
should use static keys.
