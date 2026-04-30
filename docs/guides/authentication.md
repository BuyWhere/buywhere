# Authentication Guide

## Getting an API Key

Contact the BuyWhere team to provision an API key. You'll receive:

- A **key ID** (UUID) — used for JWT tokens
- A **raw key** (`bw_live_xxxxx`) — used directly as Bearer token

Store the raw key securely — it will not be shown again.

## Using Your API Key

Include your API key in the `Authorization` header:

```bash
curl https://api.buywhere.ai/v1/search?q=laptop \
  -H "Authorization: Bearer bw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

```python
from buywhere_sdk import BuyWhere

client = BuyWhere(api_key="bw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
```

## API Key Format

- Raw keys start with `bw_live_` (production) or `bw_test_` (sandbox)
- Keys are 48+ characters, URL-safe base64
- Keys are hashed (SHA-256) before storage

## Rate Limits

Rate limits are applied per API key:

| Tier | Limit |
|------|-------|
| Free/Basic | 100 requests/minute |
| Standard | 500 requests/minute |
| Premium | 1,000 requests/minute |

Limits are tracked by API key ID when available, otherwise by IP address.

When rate limited, you'll receive:

```
HTTP 429 Too Many Requests
Retry-After: 60
```

## Error Responses

### 401 Unauthorized

Invalid or missing API key:

```json
{
  "detail": "Invalid or revoked API key"
}
```

**Solutions:**
- Verify your API key is correct
- Ensure `Authorization: Bearer <key>` header format is correct
- Check that your key hasn't been revoked

### 403 Forbidden

Invalid admin secret (for key provisioning):

```json
{
  "detail": "Invalid admin secret"
}
```

### 422 Validation Error

Request validation failed:

```json
{
  "detail": [
    {
      "loc": ["body", "product_ids"],
      "msg": "ensure this value has at least 2 items",
      "type": "value_error"
    }
  ]
}
```

### 429 Rate Limit Exceeded

Slow down your requests:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{
  "detail": "Rate limit exceeded. Retry after 60 seconds."
}
```

## Key Provisioning (Admin)

To provision new API keys, use the internal endpoint:

```bash
curl -X POST https://api.buywhere.ai/v1/keys \
  -H "Content-Type: application/json" \
  -d '{
    "developer_id": "dev_123",
    "name": "Production App",
    "tier": "standard",
    "admin_secret": "your-admin-secret"
  }'
```

Response:

```json
{
  "key_id": "uuid-of-key",
  "raw_key": "bw_live_xxxxx...",
  "tier": "standard",
  "message": "Store this key securely — it will not be shown again."
}
```

## Security Best Practices

1. **Never commit API keys** to version control
2. **Use environment variables** for key storage
3. **Rotate keys periodically** — contact support to revoke old keys
4. **Use minimal permissions** — request only the tier you need
5. **Monitor usage** — track your request counts to avoid surprises

## SDK Authentication

The Python SDK handles authentication automatically:

```python
from buywhere_sdk import BuyWhere

# Uses Bearer token auth
client = BuyWhere(api_key="bw_live_xxxxx")

# Async client for asyncio
from buywhere_sdk import AsyncBuyWhere

async with AsyncBuyWhere(api_key="bw_live_xxxxx") as client:
    results = await client.search("laptop")
```