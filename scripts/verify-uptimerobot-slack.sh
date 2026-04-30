#!/bin/bash
# verify-uptimerobot-slack.sh
# Verifies UptimeRobot Slack integration is configured correctly

set -e

echo "=== UptimeRobot Slack Integration Verification ==="
echo

# Check if webhook URL is configured
if [ -z "$UPTIMEROBOT_SLACK_WEBHOOK_URL" ]; then
    echo "ERROR: UPTIMEROBOT_SLACK_WEBHOOK_URL environment variable is not set"
    echo "  Set it with: export UPTIMEROBOT_SLACK_WEBHOOK_URL='https://hooks.slack.com/services/...'"
    exit 1
fi

echo "1. Webhook URL configured: OK"
echo "   URL: ${UPTIMEROBOT_SLACK_WEBHOOK_URL:0:50}..."
echo

# Test webhook by sending a test message
echo "2. Sending test alert to Slack..."

TEST_PAYLOAD='{
  "text": ":warning: *UptimeRobot Integration Test*\nThis is a test message to verify the Slack alerting pipeline is working.\nIf you see this, the #ops-alerts channel is configured correctly.",
  "channel": "#ops-alerts"
}'

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$TEST_PAYLOAD" \
    "$UPTIMEROBOT_SLACK_WEBHOOK_URL")

if [ "$RESPONSE" = "200" ]; then
    echo "   Test message sent successfully (HTTP $RESPONSE)"
    echo "   Please verify you received a message in #ops-alerts"
else
    echo "   ERROR: Failed to send test message (HTTP $RESPONSE)"
    echo "   Check that the webhook URL is valid and the channel exists"
    exit 1
fi

echo
echo "3. Verification complete!"
echo "   Next steps:"
echo "   - Confirm test message appeared in #ops-alerts Slack channel"
echo "   - Verify UptimeRobot monitors (api.buywhere.ai, buywhere.ai) are configured"
echo "   - Confirm alert contacts in UptimeRobot include the Slack webhook"
echo
echo "=== Verification Passed ==="