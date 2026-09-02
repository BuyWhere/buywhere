---
title: "Bulk Lookup"
description: "Batch fetch multiple products by their IDs in a single request. Use the Compare Products(/docs/api-reference/compare) endpoint with a list of IDs."
public: true
---

# Bulk Lookup

**Info:**
This endpoint requires a **Pro** or **Enterprise** tier API key.

```
GET /v1/products/compare
```

Batch fetch multiple products by their IDs in a single request. Use the [Compare Products](/docs/api-reference/compare) endpoint with a list of IDs.

For bulk data use cases, provide up to 10 product UUIDs:

## Example Request

```bash
curl -s "https://api.buywhere.ai/v1/products/compare?ids=id1,id2,id3,id4,id5" \
  -H "Authorization: Bearer $BUYWHERE_API_KEY"
```

## Response

Returns the same response format as [Compare Products](/docs/api-reference/compare), with full product details for each ID.

## Error Responses

### 403 — Tier Not Supported

If your API key tier does not support bulk operations:

```json
{
  "error": {
    "code": "INSUFFICIENT_SCOPE",
    "message": "API key does not have the required scope for this endpoint.",
    "doc_url": "https://buywhere.ai/docs/errors#INSUFFICIENT_SCOPE"
  }
}
```

Upgrade your tier at [buywhere.ai/contact](https://buywhere.ai/contact) to access bulk endpoints.
