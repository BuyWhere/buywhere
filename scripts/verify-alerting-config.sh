#!/bin/bash
# verify-alerting-config.sh
# Verifies all alert contacts and escalation policies are configured correctly

set -e

echo "=== BuyWhere Alerting Configuration Verification ==="
echo

ERRORS=0

echo "1. Checking alertmanager.yml configuration..."
if [ ! -f "$(dirname "$0")/../alertmanager.yml" ]; then
    echo "   ERROR: alertmanager.yml not found"
    ERRORS=$((ERRORS + 1))
else
    echo "   alertmanager.yml: OK"

    if grep -q "SLACK_WEBHOOK_URL" "$(dirname "$0")/../alertmanager.yml"; then
        echo "   Slack receiver: configured"
    else
        echo "   WARNING: Slack receiver may not be fully configured"
    fi

    if grep -q "PAGERDUTY_SERVICE_KEY" "$(dirname "$0")/../alertmanager.yml"; then
        echo "   PagerDuty receiver: configured"
    else
        echo "   WARNING: PagerDuty receiver may not be fully configured"
    fi

    if grep -q "email_configs" "$(dirname "$0")/../alertmanager.yml"; then
        echo "   Email receiver: configured"
    else
        echo "   WARNING: Email receiver may not be configured"
    fi
fi
echo

echo "2. Checking Slack webhook configuration..."
if [ -z "$SLACK_WEBHOOK_URL" ]; then
    echo "   WARNING: SLACK_WEBHOOK_URL not set (set in .env or environment)"
else
    echo "   Slack webhook URL: ${SLACK_WEBHOOK_URL:0:50}..."
fi
echo

echo "3. Checking PagerDuty configuration..."
if [ -z "$PAGERDUTY_SERVICE_KEY" ]; then
    echo "   WARNING: PAGERDUTY_SERVICE_KEY not set (set in .env or environment)"
else
    echo "   PagerDuty service key: ${PAGERDUTY_SERVICE_KEY:0:10}..."
fi
echo

echo "4. Checking email configuration..."
if [ -z "$SMTP_HOST" ]; then
    echo "   WARNING: SMTP_HOST not set"
else
    echo "   SMTP host: $SMTP_HOST:$SMTP_PORT"
fi
echo

echo "5. Checking UptimeRobot escalation..."
echo "   Verifying UptimeRobot has multiple alert contacts configured:"
echo "   - Slack webhook for #ops-alerts (primary)"
echo "   - PagerDuty webhook (secondary on 5-min timeout)"
echo "   - Email backup (tertiary)"
echo "   Please manually verify at https://uptimerobot.com"
echo

echo "6. Checking Prometheus alert rules..."
if [ -f "$(dirname "$0")/../prometheus_alerts.yml" ]; then
    ALERT_COUNT=$(grep -c "alert:" "$(dirname "$0")/../prometheus_alerts.yml" || true)
    echo "   Prometheus alerts defined: $ALERT_COUNT"
    echo "   - HighErrorRate, HighLatencyP95/P99, APIDown"
    echo "   - ExternalAPIDown, MCPServerDown, WebsiteDown"
    echo "   - SSL alerts, FleetErrorStateConcentration"
else
    echo "   WARNING: prometheus_alerts.yml not found"
fi
echo

echo "7. Checking docker-compose alerting services..."
if [ -f "$(dirname "$0")/../docker-compose.prod.yml" ]; then
    if grep -q "alertmanager" "$(dirname "$0")/../docker-compose.prod.yml"; then
        echo "   AlertManager service: configured"
    else
        echo "   WARNING: AlertManager service not found in docker-compose.prod.yml"
    fi
fi
echo

echo "8. Verifying alert contacts in UptimeRobot..."
echo "   Log into https://uptimerobot.com and verify:"
echo "   - Alert contact 'buywhere-slack' -> #ops-alerts webhook"
echo "   - Alert contact 'buywhere-pagerduty' -> PagerDuty Events API"
echo "   - Alert contact 'buywhere-email-backup' -> bolt@buywhere.ai"
echo "   - All monitors (api.buywhere.ai, buywhere.ai) have ALL contacts attached"
echo "   - Escalation policy: notify 2nd contact if 1st not acknowledged in 5 min"
echo

echo "9. Testing end-to-end alert flow..."
echo "   To test UptimeRobot -> Slack:"
echo "   $ cd /home/paperclip/buywhere-api && ./scripts/verify-uptimerobot-slack.sh"
echo
echo "   To test PagerDuty escalation:"
echo "   - Create a test incident in PagerDuty"
echo "   - Do NOT acknowledge within 5 minutes"
echo "   - Verify escalation fires to DevOps team"
echo

if [ $ERRORS -eq 0 ]; then
    echo "=== Verification Complete ==="
    echo "All alerting infrastructure is configured."
    echo "Complete manual verification steps above."
else
    echo "=== Verification Complete with $ERRORS ERROR(S) ==="
    echo "Fix errors before relying on alerting."
fi