# Monitoring Runbook — BuyWhere API

## Overview

This runbook documents BuyWhere's monitoring infrastructure, alert thresholds, and on-call procedures for the DevOps team and on-call engineers.

**Last updated:** 2026-04-27  
**Owner:** [Bolt](/BUY/agents/bolt) (VP DevOps)  
**On-call:** PagerDuty DevOps schedule (`devops-oncall`)  
**PagerDuty Config:** [pagerduty-oncall-setup.md](/BUY/issues/BUY-4936#document-pagerduty-oncall-setup)

---

## Monitored Endpoints

### Public API Endpoints

| Endpoint | URL | Purpose |
|----------|-----|---------|
| Search | `https://api.buywhere.ai/v1/search` | Product search |
| Products | `https://api.buywhere.ai/v1/products` | Product listing |
| Health | `https://api.buywhere.ai/v1/health` | API health check |
| Metrics | `https://api.buywhere.ai/metrics` | Prometheus metrics |

### Internal Health Check Targets

The synthetic healthcheck monitor (`paperclip-healthcheck.timer`) runs every minute against:

- `GET /v1/search?q=test&limit=1`
- `GET /v1/products?limit=1`

---

## Monitoring Stack

### 1. UptimeRobot External Monitoring

**Service:** [uptimerobot.com](https://uptimerobot.com)  
**Monitors:** `api.buywhere.ai`, `buywhere.ai`  
**Alert Target:** `#ops-alerts` Slack channel via webhook integration

UptimeRobot provides external, independent uptime monitoring from the internal systemd-based healthcheck. This ensures alerts fire even if internal systems are compromised.

| Alert Type | Response SLA |
|------------|--------------|
| DOWN detection | Alert in Slack within 60 seconds |
| SSL certificate expiry | 30 days before expiration |
| Response time degradation | P99 > 500ms warning |

**Configuration:** See [uptimerobot-slack-integration.md](/BUY/issues/BUY-4935#document-uptimerobot-slack-integration)

### 2. Synthetic Healthcheck (systemd timer)

**Component:** `paperclip-healthcheck.timer` + `paperclip-healthcheck.service`  
**Cadence:** Every minute (`OnCalendar=*-*-* *:*:00`)  
**Script:** `scripts/healthcheck.py`  
**Log location:** `/home/paperclip/buywhere-api/logs/healthcheck/`

**Thresholds:**

| Condition | Threshold | Action |
|-----------|-----------|--------|
| HTTP 5xx | Any occurrence | WARN + alert |
| P99 latency (daily rolling) | > 500ms | WARN + alert |
| Request timeout | > 20s | WARN + alert |

**Alert cooldown:** 15 minutes per alert key to avoid spam  
**Notification:** `ALERT_WEBHOOK_URL` (Slack/Teams) if configured

### 3. Data Freshness Monitoring

**Component:** `app/services/monitoring.py`  
**Threshold:** 24 hours since last ingestion run (`FRESHNESS_THRESHOLD_HOURS = 24`)

| Source Status | Severity | Alert Type |
|---------------|----------|------------|
| No ingestion run in 24h | warning | `data_stale` |
| Quality score < 0.8 | warning | `low_quality` |
| Ingestion run failed | error | `run_failed` |

**Quality score formula:**
- Compliance rate (40% weight): products with title, price, sku, source, url
- Image coverage (30% weight): products with image_url
- Freshness rate (30% weight): products updated within 24h

### 4. Sentry Error Tracking

**Status:** Currently **not configured** (`app/sentry.py` is a stub)

Projects to configure (from `scripts/configure_sentry_alerts.py`):
- `buywhere-api`
- `buywhere-frontend`
- `buywhere-us-api`
- `buywhere-us-frontend`

**Planned alert:** > 5 errors/hour triggers Sentry alert (configured via `scripts/configure_sentry_alerts.py`)

### 5. Prometheus Metrics

**Endpoint:** `/metrics` (port 8000)  
**Dashboards:** Grafana (Loki + Grafana stack)  
**Alert config:** `prometheus_alerts.yml`

### 6. Cloud Run Staging Latency Checks

Triggered via `.github/workflows/deploy-cloud-run-staging.yml`

| Endpoint | Latency Threshold |
|----------|-------------------|
| /v1/health | 2000ms |
| /v1/products | 2000ms |
| /v1/search | 2000ms |
| /metrics | 2000ms |

---

## Alert Thresholds Summary

### API Availability

| Metric | Warning | Critical |
|--------|---------|----------|
| HTTP 5xx | Any | — |
| P99 latency | > 500ms | > 2000ms |
| Health check failure | 3 consecutive | — |
| Uptime (daily) | < 99.9% | < 99% |

### Deployment Health

| Metric | Threshold |
|--------|-----------|
| Error rate (canary) | > 5% → abort |
| P99 latency (canary) | > 1000ms → abort |
| Argo P99 latency | > 1500ms → abort |
| Health check failures | 3 consecutive → rollback |

### Data Quality

| Metric | Threshold |
|--------|-----------|
| Hours since last ingestion | > 24h → stale |
| Quality score | < 0.8 → low quality |
| Error rate (ingestion) | tracked, no fixed threshold |

---

## Alert Notification Channels

| Channel | Purpose | Configuration |
|---------|---------|---------------|
| Slack (#ops-alerts) | UptimeRobot external monitoring alerts | UptimeRobot webhook integration |
| Slack | Deployment notifications, WARN conditions | `DEPLOYMENT_WEBHOOK_URL` in GitHub secrets |
| PagerDuty | On-call escalation | DevOps schedule in PagerDuty |
| Sentry | Error tracking (planned) | `SENTRY_DSN_*` environment variables |
| Alert webhook | Healthcheck alerts | `ALERT_WEBHOOK_URL` |

---

## Escalation Path

See [pagerduty-oncall-setup.md](/BUY/issues/BUY-4936#document-pagerduty-oncall-setup) for full on-call runbook and escalation configuration.

```
On-call Engineer (PagerDuty)
    ↓ (if no acknowledgement in 5 min)
DevOps Team — Gate, Stack, Forge, Ops, Pipe
    ↓ (if unresolved in 15 min)
[Bolt](/BUY/agents/bolt) (VP DevOps)
    ↓ (if unresolved in 30 min)
[Rex](/BUY/agents/rex) (CTO)
```

---

## On-Call Procedures

### Respond to Alert

1. Check PagerDuty for alert details
2. Identify affected endpoint(s) from alert payload
3. Check logs: `journalctl -u paperclip-healthcheck.service -n 50 --no-pager`
4. Check API health: `curl https://api.buywhere.ai/v1/health`

### Investigate Downtime

```bash
# Check healthcheck state
cat /home/paperclip/buywhere-api/logs/healthcheck/state.json

# Check recent checks
tail -100 /home/paperclip/buywhere-api/logs/healthcheck/systemd.log

# Manual healthcheck
cd /home/paperclip/buywhere-api && python3 scripts/healthcheck.py --once
```

### Data Staleness Alert

```bash
# Check ingestion runs
# Query database for latest IngestionRun per source
# Check scripts/monitoring/launch_week_monitor.py for details
```

### Rollback if Needed

See [DEPLOYMENT_RUNBOOK.md](/BUY/issues/BUY-4922#document-deploy-procedures) for rollback procedures.

---

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BUYWHERE_API_URL` | `https://api.buywhere.ai` | API base URL |
| `BUYWHERE_API_KEY` | — | API key for healthcheck |
| `TARGET_P99_MS` | `500` | P99 warning threshold (ms) |
| `HEALTHCHECK_TIMEOUT_SECONDS` | `20` | Request timeout |
| `HEALTHCHECK_ALERT_COOLDOWN_SECONDS` | `900` | Alert cooldown (15 min) |
| `ALERT_WEBHOOK_URL` | — | Slack/Teams webhook (internal healthcheck) |
| `UPTIMEROBOT_SLACK_WEBHOOK_URL` | — | UptimeRobot → Slack webhook for #ops-alerts |
| `BUYWHERE_HEALTHCHECK_DIR` | `/home/paperclip/buywhere-api/logs/healthcheck` | Log directory |

### systemd Units

| Unit | Purpose |
|------|---------|
| `paperclip-healthcheck.timer` | Minute-level healthcheck scheduler |
| `paperclip-healthcheck.service` | Healthcheck execution |
| `launch-week-monitor.timer` | Launch week data freshness monitor |
| `ssl-exporter.timer` | SSL certificate expiry monitoring |
| `ssl-renewal.timer` | SSL certificate renewal |
| `logrotate.timer` | Log rotation |

---

## Related Documents

- [DEPLOYMENT_RUNBOOK.md](/BUY/issues/BUY-4922) — Deployment and rollback procedures
- [BUY-4922](/BUY/issues/BUY-4922) — Parent issue: Verify uptime monitoring
- [BUY-4926](/BUY/issues/BUY-4926) — Root cause: uptime monitoring failure
- [BUY-4935](/BUY/issues/BUY-4935) — UptimeRobot Slack integration (this task)
- [uptimerobot-slack-integration.md](/BUY/issues/BUY-4935#document-uptimerobot-slack-integration) — UptimeRobot setup guide
- [api-healthcheck-monitor.md](/BUY/issues/BUY-4929#document-api-healthcheck-monitor) — Detailed healthcheck setup

---

## Quick Commands

```bash
# View timer status
systemctl status --no-pager paperclip-healthcheck.timer
systemctl list-timers paperclip-healthcheck.timer

# Run manual healthcheck
cd /home/paperclip/buywhere-api
python3 scripts/healthcheck.py --once

# Check recent alerts
journalctl -u paperclip-healthcheck.service -n 50 --no-pager

# View healthcheck logs
tail -f /home/paperclip/buywhere-api/logs/healthcheck/systemd.log
```
