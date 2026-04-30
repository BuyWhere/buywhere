# Deployment Runbook for BuyWhere API

## Overview
This document outlines the deployment process for the BuyWhere API to staging and production environments.

## Prerequisites
- Docker and docker-compose installed
- AWS CLI configured with appropriate permissions
- Access to the BuyWhere GitHub repository
- Secrets configured in GitHub:
  - AWS_ACCESS_KEY_ID
  - AWS_SECRET_ACCESS_KEY
  - GITHUB_TOKEN (for CI/CD)
  - KUBE_CONFIG_STAGING (for Kubernetes staging)
  - KUBE_CONFIG_PRODUCTION (for Kubernetes production)
  - DEPLOYMENT_WEBHOOK_URL (for Slack/Teams notifications)
  - PROMETHEUS_URL (for canary analysis)

## CI/CD Pipeline
The CI/CD pipeline is defined in `.github/workflows/ci.yml` and includes the following stages:
1. **Lint**: Runs `ruff` to check code quality.
2. **TypeCheck**: Runs `mypy` to check type annotations.
3. **Test**: Runs the test suite with coverage using `pytest`.
4. **Build**: Builds Docker images for the API and MCP server with immutable SHA tags.
5. **Deploy-Staging**: Deploys to the staging ECS cluster (if on main/master branch).
6. **Deploy-Production**: Deploys to the production ECS cluster (if pushing a version tag).
7. **Docs**: Builds the documentation using MkDocs.

## Image Tagging Strategy
Docker images are tagged with multiple tags for traceability:
- `:latest` - Points to the latest build on the default branch
- `:sha-{git-sha}` - Immutable tag referencing the exact git commit (recommended for deployments)
- `:{branch-name}` - Tags for feature branches

Production deployments use the SHA tag for reproducibility.

## Kubernetes Deployment

### Staging Deployment (deploy-k8s.yml)
Triggered automatically on pushes to `main` or `master` branches.
- Pulls latest Docker image from GHCR
- Tags and pushes to ECR
- Applies Kubernetes manifests via kustomize
- Waits for rollout completion (5 minute timeout)
- Performs HTTP health check validation
- Automated rollback on failure

### Production Deployment (deploy-k8s-prod.yml)
Triggered when pushing version tags (e.g., `v1.0.0`).
- Full deployment with enhanced monitoring
- Canary analysis with Prometheus metrics:
  - Error rate threshold: 5%
  - P99 latency threshold: 1000ms
  - Analysis duration: 5 minutes
- Slack/Teams notifications on deployment events
- Automated rollback on health check or canary analysis failure

### Blue-Green Deployment (Production Argo Rollout)
The production cluster supports blue-green deployments via Argo Rollout:
```bash
# Apply blue-green rollout
kubectl apply -f k8s/production/api-rollout-blue-green.yaml -n production

# Promote the rollout manually after verification
kubectl argo rollouts promote buywhere-api-blue-green -n production

# Abort a rollout
kubectl argo rollouts abort buywhere-api-blue-green -n production
```

### Blue-Green Services
- `buywhere-api-active`: Points to the currently live version
- `buywhere-api-preview`: Points to the new version for testing

## Staging Deployment (ECS)
The staging deployment is triggered automatically on pushes to the `main` or `master` branches.
It uses the `deploy-staging` job in the CI workflow, which:
1. Captures the previous task definition for rollback
2. Creates a pre-deployment database backup
3. Pulls the SHA-tagged Docker image
4. Updates the ECS service with a force-new-deployment
5. Waits for the service to stabilize
6. Performs health check validation (retries up to 5 times with 15-second intervals)
7. Runs smoke tests against the deployment
8. Rolls back on failure

## Production Deployment (ECS)
The production deployment is triggered when pushing a version tag (e.g., `v1.0.0`).
It uses the `deploy-prod` job in the CI workflow, which follows the same steps as staging but targets the production cluster and requires version tag trigger.

## Pre-Deployment Backup
Before each deployment, an automated backup is created:
- For ECS: Uses `aws ecs execute-command` to run pg_dump
- Backup ID format: `pre-deploy-{TIMESTAMP}` or `pre-deploy-prod-{TIMESTAMP}`
- Backups are stored in the ECS task's ephemeral storage (for quick rollback)
- Backup verification is performed to ensure the backup is restorable

### Backup Verification
The `pre-deploy-backup.sh` script performs backup verification:
```bash
# Verify a backup
./scripts/pre-deploy-backup.sh verify backups/pre-deploy-prod-20240101-120000.dump

# List available backups
./scripts/pre-deploy-backup.sh list

# Restore from backup
./scripts/pre-deploy-backup.sh restore backups/pre-deploy-prod-20240101-120000.dump
```

Verification includes:
- Schema validation using pg_restore --list
- Table and index count verification
- Restorability test (creates temporary database and restores)

## Rollback Procedures

### Automatic Rollback
The CI/CD pipeline automatically rolls back if:
- ECS/Kubernetes service fails to stabilize after deployment
- Health check fails after retry attempts
- Smoke tests fail after deployment
- Canary analysis detects error rate or latency issues

### Manual Rollback (deploy.sh)
For local deployments using `deploy.sh`:
```bash
./deploy.sh rollback
```
This uses the saved rollback state from `.rollback_state` file.

### Manual Rollback (ECS CLI)
To manually rollback to a previous task definition:
```bash
aws ecs update-service --cluster buywhere-staging --service buywhere-api --task-definition <TASK_ARN> --force-new-deployment
```
For production:
```bash
aws ecs update-service --cluster buywhere-prod --service buywhere-api --task-definition <TASK_ARN> --force-new-deployment
```

### Manual Rollback (Kubernetes)
```bash
# View rollout history
kubectl rollout history deployment/buywhere-api -n production

# Rollback to previous revision
kubectl rollout undo deployment/buywhere-api -n production

# Rollback to specific revision
kubectl rollout undo deployment/buywhere-api -n production --to-revision=<N>

# Verify rollback was successful
./scripts/rollback.sh verify-rollback production
```

### Rollback Verification

After any rollback (manual or automated), verify the rollback was successful:

```bash
./scripts/rollback.sh verify-rollback <environment>
```

This checks:
- Health endpoint responds with 200
- Readiness endpoint responds with 200
- Pods are running and stable
- Kubernetes rollout history is updated

### Get Previous Task Definition
```bash
aws ecs describe-services --cluster buywhere-prod --services buywhere-api --query 'services[0].taskDefinition' --output text
```

### Rollback State File
The `deploy.sh` script saves rollback state to `.rollback_state`:
```
PREV_TASK=arn:aws:ecs:region:account:task-definition/buywhere-api:123
DEPLOY_TIME=2024-01-01T12:00:00Z
AWS_CLUSTER=buywhere-staging
```

### Persistent Rollback State
For critical deployments, rollback state can be saved persistently to survive workflow failures:
```bash
# Save persistent rollback state
./scripts/rollback.sh save-persistent-state production prod-123 v1.2.3 arn:aws:ecs:...

# Load persistent rollback state
./scripts/rollback.sh load-persistent-state

# Update status after deployment
./scripts/rollback.sh update-persistent-state production success
./scripts/rollback.sh update-persistent-state production failed "Health check failed"
```

This creates `.rollback_state_persistent.json` which can be git-tracked for persistence across workflow failures.

## Smoke Tests
After each deployment, comprehensive smoke tests are run:

### Enhanced Smoke Tests
The enhanced smoke tests verify:
1. **Health endpoint**: Valid JSON with status="ok"
2. **Readiness endpoint**: HTTP 200 response
3. **Metrics endpoint**: HTTP 200 response
4. **Products API**: HTTP 200 response for `/v1/products?limit=1`
5. **Database health**: Via `/health/db` endpoint (if implemented)

### Pre-Deployment Health Check
Before any deployment, run the pre-deployment health check:
```bash
./scripts/pre-deployment-health-check.sh --env staging --api-url https://api-staging.buywhere.io
```

This verifies:
1. Current deployment health endpoint is responding
2. Current deployment readiness endpoint is responding
3. Current latency meets baseline expectations (if baseline exists)

Exit code 0 = safe to deploy, exit code 1 = NOT safe to deploy

## Local Development
To run the API and MCP server locally for development:
```bash
docker compose up
```
This will start:
- API on port 8000
- MCP server on port 8080
- Postgres on port 5432
- Redis on port 6379

## Health Checks
The API provides a health check endpoint at `/v1/health` that returns:
- Database health
- Disk space
- API self-test
- Scraper health

This endpoint is used in the CI/CD pipeline for validation.

## Monitoring
- **Health Checks**: `/v1/health` endpoint
- **Metrics**: Prometheus scraping on port 8000 at `/metrics`
- **Logs**: Loki + Grafana stack for centralized logging
- **Dashboards**: Grafana dashboards for deployment and API metrics

### Alerting
Configure alerts in `prometheus_alerts.yml` for:
- High error rates during deployment
- Elevated latency during rollout
- Failed health checks

### Notifications
Set `DEPLOYMENT_WEBHOOK_URL` in GitHub secrets to receive deployment notifications in Slack/Teams.

## Canary Analysis
Automated canary analysis monitors:
1. **Error Rate**: Canary error rate must stay below 5%
2. **Latency**: Canary P99 latency must stay below 1000ms
3. **Comparison**: Canary latency should not exceed 1.5x stable version latency

Script: `scripts/canary-analysis.sh`

## Feature Flags
Feature flags are configured via environment variables:
```bash
FEATURE_NEW_SEARCH=true
FEATURE_BULK_INGEST=false
FEATURE_MCP_SERVER=true
```

For production, use ConfigMap or external flag service for dynamic configuration without redeployment.

## Deployment Scripts
- `scripts/canary-analysis.sh`: Run Prometheus-based canary analysis
- `scripts/deployment-notify.sh`: Send deployment notifications to Slack/Teams
- `scripts/rollback.sh`: Manual rollback helper script (supports K8s, ECS, Argo Rollouts)
- `scripts/deployment-state.sh`: Deployment state management and tracking
- `scripts/pre-deployment-health-check.sh`: Pre-deployment health verification
- `scripts/pre-deploy-backup.sh`: Backup creation and verification
- `scripts/deployment-monitor.sh`: Post-deployment monitoring with circuit breaker
- `scripts/enhanced-health-check.sh`: Comprehensive health check for deployments
- `scripts/deployment-rehearsal.sh`: Pre-deployment validation and planning

### Deployment State Management

The `deployment-state.sh` script provides centralized deployment state tracking:

```bash
# Capture current deployment state before new deployment
./scripts/deployment-state.sh capture staging --version v1.2.3

# Verify deployment health after deployment/rollback
./scripts/deployment-state.sh verify staging

# Show deployment history
./scripts/deployment-state.sh history staging

# Show current deployment state
./scripts/deployment-state.sh current staging

# Set health baseline for an environment
./scripts/deployment-state.sh set-baseline production

# Check health against baseline before deployment
./scripts/deployment-state.sh check-baseline production
```

State is stored in `.deployment_state/` directory:
- `current_deployment.json`: Current deployment state
- `deployment_history.json`: Historical deployment records
- `health_baseline.json`: Health baselines for comparison

## Deployment Rehearsal

Before critical deployments, run the deployment rehearsal to validate the environment:

```bash
# Run full validation
./scripts/deployment-rehearsal.sh validate --env production

# Show deployment plan
./scripts/deployment-rehearsal.sh plan --env production --version v1.2.3

# Check prerequisites only
./scripts/deployment-rehearsal.sh check-prereqs --env staging
```

The rehearsal validates:
- Docker, docker-compose, AWS CLI, kubectl, Argo Rollouts availability
- Git status and uncommitted changes
- Environment file existence
- API reachability
- Health baseline comparison
- Backup directory status
- Previous deployment state

## Automated Rollback Procedures

### GitHub Actions Post-Deployment Monitoring
After a successful deployment, the CI/CD pipeline runs a post-deployment monitoring job:
- **Duration**: 600 seconds (10 minutes) for production, 300 seconds (5 minutes) for staging
- **Check Interval**: Every 30 seconds
- **Failure Threshold**: 3 consecutive failures trigger automatic rollback
- **Monitored Endpoint**: `/health` endpoint of the deployed API

The monitoring job runs in parallel with the deployment and will trigger rollback if:
1. Health check fails 3 times consecutively during the monitoring window
2. The deployment itself fails

### Argo Rollout Blue-Green Analysis
The production Kubernetes cluster uses Argo Rollout with automated analysis:

**Pre-Promotion Analysis** (`buywhere-api-pre-promotion-analysis`):
- Health check verification
- Startup error rate monitoring (must stay below 10%)

**Post-Promotion Analysis** (`buywhere-api-prometheus-analysis`):
- Error rate monitoring (must stay below 5%)
- P99 latency monitoring (must stay below 1500ms)
- Continuous health check verification
- Consecutive health failure tracking

If any analysis metric fails, the rollout is automatically aborted and the previous version remains active.

### Deployment Health Alerts
Prometheus alerts monitor for post-deployment issues:
- `DeploymentHealthCheckFailing`: Health endpoint down for 2+ minutes
- `NewDeploymentErrorRateSpike`: Error rate exceeds 10%
- `DeploymentLatencySpike`: P99 latency exceeds 3s
- `PostDeploymentHealthFlapping`: Intermittent health check failures

### Rollback Triggers Summary
| Trigger | Threshold | Action |
|---------|-----------|--------|
| Health check failure (ECS) | 3 consecutive | Automatic rollback |
| Error rate (Argo analysis) | > 5% | Abort promotion |
| P99 latency (Argo analysis) | > 1500ms | Abort promotion |
| Health check (Argo analysis) | 3 failures | Abort promotion |

## Troubleshooting
1. **Deployment fails health check**: Check the logs of the ECS/Kubernetes service and verify the API is responding.
2. **Image pull fails**: Ensure the Docker image was built and pushed correctly to the registry.
3. **Credentials issues**: Verify that AWS credentials are correctly set in GitHub secrets.
4. **Database connection issues**: Verify that the RDS instance is accessible and the credentials in the task definition are correct.
5. **Rollback fails**: Check Kubernetes cluster connectivity and kubectl context.

## Deployment SLA Compliance

The deployment system tracks SLA metrics to ensure reliable deployments. Use the `deployment-sla.sh` script to monitor compliance.

### SLA Thresholds

| Environment | Uptime | Success Rate | Max Avg Duration |
|-------------|--------|--------------|------------------|
| Production  | 99.9%  | 99.0%        | 600s             |
| Staging     | 99.0%  | 95.0%        | 300s             |

### SLA Monitoring Commands

```bash
# Generate SLA compliance report
./scripts/deployment-sla.sh report --env production --period 30

# Check deployment trends
./scripts/deployment-sla.sh trend --env production --days 7

# Verify SLA compliance (exit code 0 if compliant, 1 if not)
./scripts/deployment-sla.sh check --env production

# Record SLA snapshot
./scripts/deployment-sla.sh record --env production
```

### SLA Metrics

The system tracks:
- **Uptime Percentage**: Based on rollback history and downtime
- **Success Rate**: Percentage of deployments that didn't require rollback
- **Average Deployment Duration**: Mean time to complete a deployment
- **Total Deployments/Rollbacks**: Volume metrics over the period

SLA data is stored in `.deployment_state/deployment_sla.json`.

## Feature Flag Management

Feature flags can be toggled dynamically via API without requiring redeployment.

### Feature Flags API

Base path: `/admin/feature-flags`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/feature-flags` | GET | Get all feature flags with status |
| `/admin/feature-flags/{flag}` | GET | Get specific flag status |
| `/admin/feature-flags/{flag}/detailed` | GET | Get flag with change history |
| `/admin/feature-flags/override` | POST | Toggle flag at runtime |
| `/admin/feature-flags/batch-update` | POST | Batch update multiple flags |
| `/admin/feature-flags/override/{flag}` | DELETE | Clear override (revert to config) |
| `/admin/feature-flags/history/all` | GET | Get flag change audit trail |

### Available Feature Flags

- `feature_new_search`: New search algorithm
- `feature_bulk_ingest`: Bulk data ingestion
- `feature_mcp_server`: MCP server integration
- `feature_advanced_analytics`: Advanced analytics dashboard
- `feature_experimental_scraper`: Experimental scraper features

### Example: Toggle a Flag

```bash
curl -X POST "https://api.buywhere.io/admin/feature-flags/override" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"flag": "feature_new_search", "enabled": true}'
```

### Kubernetes ConfigMap Sync

When running in Kubernetes, flag overrides are automatically synced to the `buywhere-feature-flags` ConfigMap for persistence across pod restarts.

## Enhanced Deployment Notifications

Deployment notifications now include detailed metrics and context:

- Deployment duration
- Health check latency
- Commit SHA and branch name
- Links to Grafana dashboards
- Rollback reason when applicable

### Notification Variables

| Variable | Description |
|---------|-------------|
| `DEPLOYMENT_ID` | Unique deployment identifier |
| `DURATION` | Deployment duration in seconds |
| `HEALTH_LATENCY_MS` | Health check latency |
| `HEALTH_STATUS` | Health check result |
| `ROLLBACK_REASON` | Reason for rollback if applicable |
| `COMMIT_SHA` | Git commit SHA |
| `BRANCH_NAME` | Branch name |
| `DEPLOYMENT_TYPE` | blue-green, canary, or standard |

## Cloud Run Deployment (Staging)

### Overview
The BuyWhere API can be deployed to Google Cloud Run for staging validation. Cloud Run provides a fully managed serverless platform for containerized applications.

### Workflow
The Cloud Run staging deployment is defined in `.github/workflows/deploy-cloud-run-staging.yml` and includes:

1. **Build**: Builds Docker image and pushes to Google Container Registry (GCR)
2. **Deploy**: Deploys image to Cloud Run with Cloud SQL proxy
3. **API Latency Smoke Test**: Validates API response times across multiple endpoints
4. **Cloud SQL Load Check**: Tests database query performance through the deployed service

### Prerequisites
- Google Cloud project with Cloud Run API enabled
- Cloud SQL instance (PostgreSQL) with private IP
- Service account with roles:
  - `roles/run.admin`
  - `roles/cloudsql.client`
  - `roles/containerregistry.serviceAgent`

### Required Secrets
Configure these in GitHub Secrets:
- `GCP_SA_KEY`: JSON credentials for the service account
- `CLOUD_SQL_STAGING_CONNECTION_STRING`: Cloud SQL connection string (format: `project:region:instance`)
- `REDIS_STAGING_URL`: Redis connection URL
- `API_KEY_SECRET_STAGING`: API encryption secret
- `SENTRY_DSN_STAGING`: Sentry DSN for error tracking

### Latency Thresholds
| Endpoint | Threshold |
|----------|-----------|
| /v1/health | 2000ms |
| /v1/products | 2000ms |
| /v1/search | 2000ms |
| /metrics | 2000ms |

### Cloud SQL Load Check
The load check tests:
- Search queries (10 sample queries)
- Product list queries
- Category queries

Thresholds:
- Slow query: >100ms
- Critical query: >500ms
- Failure rate: <10% acceptable

### Rollback
Cloud Run deployments can be rolled back to the previous revision:
```bash
gcloud run services update-traffic buywhere-api-staging \
  --to-revisions PREVIOUS_REVISION=100
```

### Scripts
- `scripts/cloud-run-latency-smoke-test.sh`: API latency smoke test
- `scripts/cloud-sql-load-check.sh`: Cloud SQL load check

## Contact
For deployment questions, contact the DevOps team:
- [Bolt](/BUY/agents/bolt) (VP DevOps) — escalation path for production issues
- [Gate](/BUY/agents/gate), [Stack](/BUY/agents/stack), [Forge](/BUY/agents/forge), [Ops](/BUY/agents/ops), [Pipe](/BUY/agents/pipe) — DevOps engineers for CI/CD, infrastructure, and deployment automation

For urgent production incidents, page via the on-call rotation in PagerDuty (DevOps schedule).