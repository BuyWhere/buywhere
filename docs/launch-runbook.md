# BuyWhere API — Launch Day Runbook (April 23, 2026)

> **Audience:** On-call engineer during and after US launch window  
> **Scope:** `api.buywhere.ai` — REST API, MCP server, catalog DB, Redis  
> **Last updated:** 2026-04-19

---

## 1. Service Overview

| Service | Port | Health endpoint | Stack |
|---------|------|-----------------|-------|
| REST API | 3000 | `GET /health` | Node.js, Express, PostgreSQL, Redis |
| MCP server | 8081 | `GET /health` | Node.js, SSE |
| PgBouncer | 5436 | — | connection pooler (max 100 server conns) |
| Redis | 6380 | `redis-cli ping` | rate-limit counters, nightly job state |

**API base URL:** `https://api.buywhere.ai`

---

## 2. Health Checks

### Quick health check
```bash
curl -s https://api.buywhere.ai/health | jq .
```
Expected response:
```json
{
  "status": "ok",
  "ts": "2026-04-23T...",
  "catalog": { "total_products": 5000000 }
}
```
If `status` is `"error"` or the request times out, escalate immediately (§6).

### Docker service status
```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
# Expected: api, mcp, redis, pgbouncer all "Up (healthy)"
```

### Redis connectivity
```bash
redis-cli -p 6380 ping   # Expected: PONG
redis-cli -p 6380 info memory | grep used_memory_human
```

### Database via PgBouncer
```bash
psql postgresql://buywhere:buywhere@localhost:5436/catalog -c "SELECT COUNT(*) FROM products;"
```

---

## 3. Key Metrics to Watch on Launch Day

| Metric | Target | Alert threshold |
|--------|--------|-----------------|
| `/health` response time | < 200ms | > 500ms |
| `GET /v1/products/search` p95 | < 100ms | > 300ms |
| `POST /v1/auth/register` p95 | < 200ms | > 500ms |
| HTTP 5xx rate | < 0.1% | > 1% |
| HTTP 429 rate | expected under heavy free-tier load | > 30% of all requests |
| Redis memory | < 400 MB | > 480 MB (512 MB limit) |
| PgBouncer active conns | < 90 | ≥ 100 (pool exhaustion) |

**Check Sentry error dashboard:** `https://sentry.io/organizations/buywhere/` *(credentials in AWS Secrets Manager — `buywhere/sentry`)*

**Check uptime monitor:** UptimeRobot dashboard *(see §5)*

---

## 4. Rate Limit Reference

| Tier | RPM | Daily |
|------|-----|-------|
| Free | 60 | 1,000 |
| Pro | 300 | 10,000 |
| Enterprise | 1,000 | 100,000 |

Rate limits enforced in Redis. Keys: `rl:rpm:<api_key>:<minute_window>` and `rl:daily:<api_key>:<date>`.

**To check a specific key's current rate counter:**
```bash
redis-cli -p 6380 keys "rl:rpm:*" | head -5
redis-cli -p 6380 get "rl:rpm:<key>:<window>"
```

**If rate limits appear broken** (clients not getting 429 when they should, or getting 429 incorrectly):
1. Check Redis is healthy: `redis-cli -p 6380 ping`
2. If Redis is down, the middleware falls back to pass-through (all requests allowed) — this is a known risk
3. Restart Redis container if needed: `docker compose restart redis`

---

## 5. External Uptime Monitoring

**Provider:** UptimeRobot  
**Monitor URL:** `https://api.buywhere.ai/health`  
**Check interval:** 1 minute  
**Alert contact:** on-call Slack channel `#oncall-api`

> **⚠️ SETUP REQUIRED:** UptimeRobot account and monitor must be provisioned before April 23. See [BUY-3415](/BUY/issues/BUY-3415).

To verify the monitor is live: log in to UptimeRobot → check `api.buywhere.ai/health` shows as "Up".

---

## 6. Escalation Path

| Severity | Response time | Who | How |
|----------|---------------|-----|-----|
| P0 — API down or 5xx > 5% | 5 min | On-call engineer | Slack `#oncall-api` + PagerDuty |
| P1 — latency > 2× target | 15 min | On-call engineer | Slack `#oncall-api` |
| P2 — elevated 429 / rate limit issue | 30 min | On-call engineer | Slack `#eng-backend` |
| DB/Redis failure | immediate | On-call + Rex (CTO) | PagerDuty |

**Rex (CTO):** escalation for infrastructure-level failures  
**Vera (CEO):** business-level decisions (disable launch, rollback)

---

## 7. Rollback Procedures

### Roll back the API to a previous image
```bash
# List available images
docker images buywhere-api

# Stop current, start previous
docker compose down api
docker compose run -d --rm -e IMAGE_TAG=<prev_tag> api
```

### Disable public search temporarily (maintenance mode)
Set an environment variable and restart:
```bash
# In docker-compose.yml, add to api environment:
MAINTENANCE_MODE=true
docker compose up -d api
```
> Note: maintenance mode returns `503` on all `/v1/*` endpoints if `MAINTENANCE_MODE=true` is set. Confirm this middleware exists before relying on it; if not, a quick nginx upstream redirect to a static 503 page is the fallback.

### Restart individual services
```bash
docker compose restart api      # restart REST API (< 5s downtime)
docker compose restart mcp      # restart MCP server (< 5s downtime)
docker compose restart redis    # ⚠️ clears all rate-limit counters
docker compose restart pgbouncer  # ⚠️ drops active DB connections
```

---

## 8. Log Access

```bash
# Live API logs
docker compose logs -f api

# Last 200 lines
docker compose logs --tail=200 api

# Filter for errors
docker compose logs api 2>&1 | grep -E '"status":(4|5)[0-9]{2}'

# Rate limit hits
docker compose logs api 2>&1 | grep "rate-limit"
```

---

## 9. Pre-Launch Checklist (April 22–23)

- [ ] Load test results posted on [BUY-3414](/BUY/issues/BUY-3414) (p95 < targets, failure rate < 0.1%)
- [ ] Rate limit enforcement confirmed correct at all tiers
- [ ] Sentry project active with on-call alert routing to `#oncall-api`
- [ ] UptimeRobot monitor active at 1-min interval
- [ ] `/health` endpoint confirmed reachable externally
- [ ] Docker services all `Up (healthy)` on launch host
- [ ] Redis memory below 400 MB headroom
- [ ] PgBouncer pool not saturated
- [ ] On-call rotation confirmed for April 23 window

---

## 10. Useful Commands Reference

```bash
# API base health
curl -s https://api.buywhere.ai/health

# Search endpoint smoke test (replace with valid API key)
curl -s "https://api.buywhere.ai/v1/products/search?q=vacuum&limit=5" \
  -H "X-API-Key: <your-key>" | jq '.total, (.products | length)'

# Auth register smoke test
curl -s -X POST https://api.buywhere.ai/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}' | jq .

# Catalog product count
psql postgresql://buywhere:buywhere@localhost:5436/catalog \
  -c "SELECT COUNT(*) FROM products;"

# Redis rate limit key count (how many callers are active)
redis-cli -p 6380 keys "rl:rpm:*" | wc -l
```
