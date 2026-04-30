# BUY-4353 OWASP Top 10 Audit

Date: 2026-04-25
Repo: `buywhere-api`
Commit reviewed: `a5781aa9`
Auditor: Zeno

## Scope

- `app/main.py`
- `app/routers/`
- `app/auth.py`
- `app/request_logging.py`
- `requirements.txt`

Note: the assigned Codex workspace was empty for this heartbeat. The audit was performed against the matching FastAPI repository at `/home/paperclip/buywhere-api`.

## Executive Summary

The API has two high-severity access control/authentication flaws:

1. Any valid API key can access `/admin/*` data endpoints, including developer PII, API key metadata, usage metrics, and request logs.
2. `POST /v1/keys` provisions new API keys using a static secret derived from `jwt_secret_key`, and that secret remains the default string `change-me-in-production` when the env var is unset.

Additional medium-severity issues exist in CORS configuration, bootstrap-key protection, unauthenticated operational webhooks, error logging, and dependency hygiene.

## Findings

### High

#### 1. Broken access control on `/admin/*` endpoints

- CWE: CWE-862 / CWE-284
- OWASP: A01 Broken Access Control
- Evidence:
  - [`app/routers/admin.py:115`](/home/paperclip/buywhere-api/app/routers/admin.py:115) through [`app/routers/admin.py:163`](/home/paperclip/buywhere-api/app/routers/admin.py:163) gate admin routes with `Depends(get_current_api_key)` only.
  - [`app/routers/admin.py:692`](/home/paperclip/buywhere-api/app/routers/admin.py:692) and [`app/routers/admin.py:755`](/home/paperclip/buywhere-api/app/routers/admin.py:755) expose the full developer list and per-developer detail, including email, Stripe fields, API key metadata, and request counts, again with only `get_current_api_key`.
  - [`app/routers/feature_flags.py:19`](/home/paperclip/buywhere-api/app/routers/feature_flags.py:19) already defines a proper `get_current_admin_api_key` tier check, which the main admin router does not use.
- Impact:
  - Any customer or leaked API key can read internal operator data, developer emails, API key inventory, usage analytics, and session/log data across tenants.
  - This is a direct IDOR / privilege-escalation path from normal developer access into operator-only data.
- Remediation:
  - Apply a shared `get_current_admin_api_key` dependency to the entire `/admin` router or split operator-only routes behind a dedicated router with enforced tier checks.
  - Add negative tests proving `free`/`pro` keys receive `403` for every `/admin/*` endpoint.

#### 2. Internal API-key provisioning protected by a predictable secret

- CWE: CWE-798 / CWE-306
- OWASP: A07 Identification and Authentication Failures
- Evidence:
  - [`app/routers/keys.py:19`](/home/paperclip/buywhere-api/app/routers/keys.py:19) sets `ADMIN_SECRET = settings.jwt_secret_key`.
  - [`app/routers/keys.py:36`](/home/paperclip/buywhere-api/app/routers/keys.py:36) exposes `POST /v1/keys` without normal authentication and authorizes purely by comparing `body.admin_secret` to that static value.
  - [`app/main.py:54`](/home/paperclip/buywhere-api/app/main.py:54) mutates `settings.jwt_secret_key` during app startup if the env var is unset, but that happens after `ADMIN_SECRET` has already been bound in `keys.py`, leaving the guard value as the literal default string.
- Impact:
  - In any deployment missing `JWT_SECRET_KEY`, an attacker can provision arbitrary API keys by posting `admin_secret=change-me-in-production`.
  - Even when `JWT_SECRET_KEY` is set, coupling an internal provisioning secret to the JWT signing secret increases blast radius and creates a single-secret compromise path.
- Remediation:
  - Remove `POST /v1/keys` from public routing or require authenticated admin-tier credentials.
  - If a separate bootstrap secret is still needed, use a dedicated env var with startup validation that fails closed when unset.
  - Add a startup check that refuses to boot with default auth secrets in non-test environments.

### Medium

#### 3. CORS misconfiguration allows wildcard origins with credentials

- CWE: CWE-942
- OWASP: A05 Security Misconfiguration
- Evidence:
  - [`app/main.py:85`](/home/paperclip/buywhere-api/app/main.py:85) configures `allow_origins=["*"]` together with `allow_credentials=True`.
- Impact:
  - This is an unsafe browser-facing policy and typically invalid per CORS semantics. It risks accidental cross-origin exposure if browsers or proxies handle it inconsistently, especially for user-token flows under `/api/auth/*`.
- Remediation:
  - Replace `*` with an explicit allowlist and disable credentials for public unauthenticated endpoints that do not require browser cookies or auth headers.

#### 4. Bootstrap-key endpoint trusts the `Host` header instead of the client origin

- CWE: CWE-346
- OWASP: A01 Broken Access Control / A05 Security Misconfiguration
- Evidence:
  - [`app/routers/keys.py:75`](/home/paperclip/buywhere-api/app/routers/keys.py:75) exposes `POST /v1/keys/bootstrap`.
  - [`app/routers/keys.py:91`](/home/paperclip/buywhere-api/app/routers/keys.py:91) authorizes bootstrap if the `Host` header starts with `127.0.0.1` or `localhost`.
- Impact:
  - Reverse proxies can forward attacker-controlled `Host` headers, which makes this check spoofable if the route is reachable externally during first-run/bootstrap.
- Remediation:
  - Remove the route from production builds, or gate it behind an out-of-band bootstrap token plus real network-layer restrictions.
  - If locality is required, validate the peer address from trusted proxy headers only after strict proxy configuration.

#### 5. Unauthenticated Alertmanager webhook can create internal Paperclip issues

- CWE: CWE-306
- OWASP: A01 Broken Access Control / A05 Security Misconfiguration
- Evidence:
  - [`app/routers/alertmanager_webhooks.py:131`](/home/paperclip/buywhere-api/app/routers/alertmanager_webhooks.py:131) exposes `POST /webhooks/alerts` with no signature, auth, IP allowlist, or shared secret verification.
  - The handler can call Paperclip and create high-priority issues using server-side credentials at [`app/routers/alertmanager_webhooks.py:103`](/home/paperclip/buywhere-api/app/routers/alertmanager_webhooks.py:103).
- Impact:
  - Any external caller able to reach this endpoint can trigger noisy operational actions and potentially create unbounded internal work items.
- Remediation:
  - Require an HMAC signature or mTLS from Alertmanager, and ideally restrict ingress by source IP/CIDR at the edge.
  - Rate-limit and deduplicate alert-triggered issue creation.

#### 6. Error logging records raw exception messages

- CWE: CWE-209 / CWE-532
- OWASP: A02 Cryptographic Failures / A09 Security Logging and Monitoring Failures
- Evidence:
  - [`app/request_logging.py:265`](/home/paperclip/buywhere-api/app/request_logging.py:265) and [`app/request_logging.py:280`](/home/paperclip/buywhere-api/app/request_logging.py:280) write `str(exc)` into structured logs.
- Impact:
  - Exception strings often contain SQL fragments, third-party responses, tokens in failing URLs, or internal validation payloads. This increases sensitive-data exposure in logs.
- Remediation:
  - Log stable error codes/types by default and redact or hash known-sensitive values before emission.
  - Keep full exception bodies only in tightly controlled observability backends with explicit redaction.

### Low

#### 7. Default-secret startup behavior avoids weak JWT signing at runtime, but fails open operationally

- CWE: CWE-1188
- OWASP: A05 Security Misconfiguration
- Evidence:
  - [`app/main.py:54`](/home/paperclip/buywhere-api/app/main.py:54) replaces the default JWT secret with an ephemeral random key instead of failing startup.
- Impact:
  - This is better than serving traffic with the literal default secret, but it silently invalidates sessions after restarts and masks a production misconfiguration that should block deploys.
- Remediation:
  - Fail fast in non-test environments when `JWT_SECRET_KEY` is unset or defaulted.

## Injection Review

- I did not find a clear exploitable SQL injection path in the sampled raw SQL. The inspected search and ingest queries generally use SQLAlchemy expressions or `text(...).bindparams(...)`.
- No direct `subprocess`, `os.system`, or `shell=True` execution paths were identified in the audited FastAPI request handlers.
- This should still be regression-tested because the codebase contains many ad hoc SQL expressions, and future string interpolation into `text()` would be easy to introduce.

## Dependency Audit

Command run:

```bash
/tmp/buywhere-pip-audit/bin/pip-audit -r requirements.txt
```

Result: `24` known vulnerabilities across `4` packages.

Packages with findings:

- `lxml==6.0.2`
  - `CVE-2026-41066`
  - Fix: `6.1.0`
- `python-multipart==0.0.24`
  - `CVE-2026-40347`
  - Fix: `0.0.26`
- `strawberry-graphql==0.243.0`
  - `CVE-2025-22151`
  - `CVE-2026-35526`
  - `CVE-2026-35523`
  - Fix: `0.257.0` minimum for the first advisory, `0.312.3` for full coverage
- `aiohttp==3.11.18`
  - `CVE-2025-53643`
  - `CVE-2025-69223`
  - `CVE-2025-69224`
  - `CVE-2025-69225`
  - `CVE-2025-69226`
  - `CVE-2025-69227`
  - `CVE-2025-69228`
  - `CVE-2025-69229`
  - `CVE-2025-69230`
  - `CVE-2026-22815`
  - `CVE-2026-34513`
  - `CVE-2026-34514`
  - `CVE-2026-34515`
  - `CVE-2026-34516`
  - `CVE-2026-34517`
  - `CVE-2026-34518`
  - `CVE-2026-34519`
  - `CVE-2026-34520`
  - `CVE-2026-34525`
  - Fix: `3.13.4`

## Recommended Next Actions

1. Treat `/admin/*` authorization and `/v1/keys` provisioning as immediate fixes before broader public rollout.
2. Lock down operational webhooks and bootstrap paths.
3. Upgrade `aiohttp`, `strawberry-graphql`, `python-multipart`, and `lxml`, then rerun `pip-audit`.
4. Add a security test suite covering:
   - admin route denial for non-admin keys
   - secret/bootstrap route denial in production config
   - webhook signature enforcement
   - startup failure on default secrets
