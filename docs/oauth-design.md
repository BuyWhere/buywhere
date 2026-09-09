# BuyWhere OAuth 2.1 — Design (v1, 2026-08-22)

**Status**: approved-for-scaffold (E1/W2 item pulled early by the accelerator loop).
**Scaffold**: `/v1/oauth/register` and `/v1/oauth/token` ship as 501 stubs with this
contract embedded; implementation milestones below.

## Why

The MCP registry, ChatGPT Apps, and Claude Connectors all require or strongly prefer
OAuth for agent-facing services. Today BuyWhere auths with static bearer API keys.
OAuth 2.1 in front of the existing key infrastructure gets us registry-ready without
touching the enforcement stack (tiers, rate limits, `is_internal` labeling, usage
accounting all continue to hang off `api_keys`).

## Principles

1. **OAuth is a front door to the existing key system, not a parallel system.**
   Every issued access token maps 1:1 to an internal `api_keys` row created (or
   linked) at token time. All existing middleware keeps working unchanged.
2. **OAuth 2.1 baseline**: PKCE mandatory on authorization-code; no implicit grant;
   no password grant; refresh-token rotation with reuse detection.
3. **Open dynamic client registration** (RFC 7591) — agents self-register the way
   they already self-serve keys; abuse handled by rate limits, not gatekeeping.

## Endpoints

| Endpoint | RFC | Notes |
|---|---|---|
| `GET /.well-known/oauth-authorization-server` | 8414 | metadata; ships in M2 (only when endpoints are real — never advertise 501s) |
| `POST /v1/oauth/register` | 7591 | open DCR; returns `client_id` (+`client_secret` only for `confidential` clients) |
| `GET /v1/oauth/authorize` | 6749/2.1 | code + PKCE (S256 only); M3 |
| `POST /v1/oauth/token` | 6749/2.1 | grants: `authorization_code`, `client_credentials`, `refresh_token` |
| `POST /v1/oauth/revoke` | 7009 | revokes token → deactivates linked api_key |

## Grants → key mapping

- **client_credentials** (M2, first real grant): server-to-server agents. Token issue
  creates/links an `api_keys` row (`signup_channel='oauth'`, tier from client record,
  default = free tier). Access token = opaque `bwoat_` + 32B urlsafe; stored as
  SHA-256 hash next to the key row. TTL 3600s; no refresh (re-mint via grant).
- **authorization_code + PKCE** (M3): human-approved agent access. Adds a consent
  page on buywhere.ai; code TTL 60s, single-use, PKCE S256 verified.
- **refresh_token** (M3): rotation on every use; family invalidation on reuse.

## Scopes (v1)

- `catalog.read` — /v1/products/* search/get/deals
- `offers.read` — prices, availability, affiliate URLs
- (reserved) `clicks.write`, `admin` — never issued via open DCR.

Scope enforcement: token → api_key row carries `scopes` (column already exists on
`api_keys`); middleware gains a single scope check where routes declare a required
scope; keys minted pre-OAuth have NULL scopes = full legacy access (grandfathered).

## Storage (new tables, catalog DB, additive migration)

- `oauth_clients(id uuid pk, client_id text unique, client_secret_hash text null,
  client_name text, client_type text check in ('public','confidential'),
  redirect_uris text[], scopes text[], created_at, disabled_at, metadata jsonb)`
- `oauth_codes(code_hash text pk, client_id, redirect_uri, scope text[],
  code_challenge text, code_challenge_method text, api_key_id, expires_at,
  used_at)` — 60s TTL, swept by existing reaper cadence.
- `oauth_tokens(token_hash text pk, client_id, api_key_id, kind text
  check in ('access','refresh'), family_id uuid, expires_at, revoked_at,
  rotated_from text null)`

## Abuse controls

- `POST /register`: 5/hour/IP (reuse the existing express rate-limit util).
- `POST /token`: 30/min/client_id; failures count double.
- Registration returns 201 with client_id but tier stays `free` until a human
  or billing upgrade path promotes it — same economics as today's keys.

## Rollout milestones

- **M1 (this commit)**: this doc + 501 stubs with machine-readable contract
  (`error=not_implemented`, `contract` field describing the future request/response).
- **M2**: DCR + client_credentials + revoke + well-known metadata; internal QA client.
- **M3**: authorize + PKCE + consent page + refresh rotation.
- **M4**: MCP registry / ChatGPT Apps submission flips to OAuth; static keys remain
  supported indefinitely for direct API customers.

## Non-goals (v1)

No OIDC/id_token, no JWT access tokens (opaque only — avoids key-rotation classes),
no per-scope pricing (billing stays key-tier-based), no third-party IdP federation.
