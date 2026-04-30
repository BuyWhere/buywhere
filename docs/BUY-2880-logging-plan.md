# Plan: Centralized Logging Aggregation for All Microservices

## Issue
[BUY-2880](/BUY/issues/BUY-2880) - Implement centralized logging aggregation for all microservices

## Status
Phase 2, 3, 4, 5 Complete; Phase 6 Pending

## Progress

### ✅ Completed
- **Phase 2**: Docker Compose Logging Labels
  - Added `service` and `environment` labels to all services in `docker-compose.yml`
  - Added `labels: "service,environment"` to all logging configurations
  - All scrapers (shopee, lazada, carousell, qoo10, amazon-sg) now have proper labels

- **Phase 3**: Added Loki + Fluent Bit + Promtail + Grafana to docker-compose.yml
  - Loki at port 3200 for local centralized log storage
  - Fluent Bit configured to collect Docker container logs and app logs
  - Promtail configured for Docker service discovery with label extraction
  - Grafana at port 3000 with Loki datasource provisioned
  - API service mounts `api_logs` volume for Fluent Bit collection

- **Phase 4**: Loki Retention Policies
  - Production: Hot (7d look-back), Warm (30d retention) configured
  - Cold storage (90d) requires AWS S3 lifecycle policy (separate infrastructure task)

- **Phase 5**: Grafana Dashboard
  - Dashboard already has service selector, level filter, container filter
  - Queries use variables that auto-discover all services including scraper-fleet
  - Log stream panel with JSON parsing configured

## Problem Statement

BuyWhere has multiple microservices (API, scrapers, MCP, background jobs) that currently log in different formats. This makes it difficult to:
- Aggregate and search logs across services
- Correlate errors across service boundaries
- Set up unified alerting
- Build service-specific dashboards

## Current State

### What Exists
- `docs/logging-schema.md` - Standardized logging schema specification
- `app/logging_centralized.py` - Centralized logger for API service
- `app/request_logging.py` - Request logging middleware with structured output
- `scrapers/scraper_logging.py` & `base_scraper.py` - Scraper-specific structured logging
- `docker-compose.prod.yml` - Loki + Fluent Bit + Grafana stack
- `k8s/production/` & `k8s/staging/` - Fluent Bit and Loki Kubernetes configurations
- `grafana/provisioning/dashboards/loki-logs.json` - Loki logs dashboard
- `k8s/production/loki-alerts-configmap.yaml` - Loki alerting rules

### Gaps Identified
1. **Inconsistent log formats**: Scrapers use `platform` field; API uses `service` field
2. **Missing service labels**: ~~Docker Compose scraper services lack labels for Fluent Bit filtering~~ ✅ FIXED
3. **No unified job label**: Loki queries reference `job="buywhere-api"` but scrapers use `job="scraper-fleet"`
4. **Missing log level standardization**: Log levels not consistently applied
5. **Grafana dashboard limited**: ~~Current dashboard only shows API logs, not scraper fleet logs~~ ✅ FIXED (variables auto-discover)
6. **Missing centralized logging in docker-compose.yml**: ~~Local dev lacked Loki/Fluent Bit stack~~ ✅ FIXED
7. **Cold storage tier (90d)**: Requires AWS S3 lifecycle policy - tracked separately

## Implementation Plan

### Phase 1: Unify Log Format Across All Services

**1.1 Update `scrapers/base_scraper.py` to use centralized logging**
- Import `get_logger` from `app.logging_centralized`
- Replace `StructuredLogger` with centralized logger
- Map scraper-specific fields to schema fields:
  - `platform` → `service`
  - `error_type` → include in `metadata`
- Add `scraper_name` as service identifier

**1.2 Update `app/logging_centralized.py`**
- Add `log_scraper_progress` function already exists but ensure it's properly integrated

### Phase 2: Docker Compose Logging Labels

**2.1 Update `docker-compose.yml` scraper services**
Add logging labels to all scraper services:
```yaml
logging:
  driver: json-file
  options:
    max-size: "50m"
    max-file: "5"
    labels: "service,environment"
```

**2.2 Add labels to all service definitions**
- api, redis, db, migrate services need `service` label

### Phase 3: Fluent Bit Configuration Updates

**3.1 Update parsers.conf for unified parsing**
- Add parser for scraper log format
- Ensure `timestamp`, `level`, `service`, `message` fields are extracted

**3.2 Add service label extraction**
- Use Kubernetes labels and Docker container labels
- Extract `service` label for Loki label mapping

### Phase 4: Loki Configuration

**4.1 Update Loki schema**
- Ensure index naming follows `logs-{service}-YYYY.MM.DD` convention

**4.2 Verify retention policies**
- Hot: 7 days
- Warm: 30 days
- Cold: 90 days

### Phase 5: Grafana Dashboard Updates

**5.1 Update loki-logs.json dashboard**
- Add service selector dropdown
- Add log level filter
- Add search functionality
- Include scraper-fleet queries alongside API queries

### Phase 6: Verification (Pending Deployment)

**6.1 Test log flow**
- Generate test logs from each service
- Verify logs appear in Loki
- Verify Grafana can query all services

**6.2 Verify alerting**
- Test Loki alert rules fire correctly

**Note**: Phase 6 requires deployment to staging/production. After deployment:
1. Verify Loki receives logs: `curl loki:3200/ready`
2. Check Grafana at port 3000 for log queries
3. Test alert rules in Loki alerting config

## Files to Modify

1. `scrapers/base_scraper.py` - Use centralized logging
2. `scrapers/scraper_logging.py` - Keep for backwards compatibility, use centralized logger
3. `docker-compose.yml` - Add logging labels to all services
4. `docker-compose.prod.yml` - Ensure all services have proper labels
5. `k8s/production/fluent-bit-configmap.yaml` - Update parsers for unified format
6. `k8s/staging/fluent-bit-configmap.yaml` - Same updates
7. `grafana/provisioning/dashboards/loki-logs.json` - Add multi-service support

## Success Criteria

- [ ] All services output JSON logs to stdout with consistent schema
- [ ] Fluent Bit collects logs from all containers
- [ ] Loki stores logs with proper labels for filtering
- [ ] Grafana dashboard shows logs from all services
- [ ] Loki alerts fire for errors in any service
- [ ] Logs can be correlated by `trace_id` across service boundaries