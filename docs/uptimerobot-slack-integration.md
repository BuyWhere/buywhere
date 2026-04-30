# UptimeRobot Slack Integration

## Overview

This document describes how to configure UptimeRobot to send alert notifications to a Slack #ops-alerts channel.

UptimeRobot is an external uptime monitoring service that monitors `api.buywhere.ai` and `buywhere.ai` endpoints independently from the internal `paperclip-healthcheck.timer` systemd service.

## Prerequisites

- UptimeRobot account with admin access to monitors
- Slack workspace with permission to create channels and webhooks

---

## Step 1: Create #ops-alerts Slack Channel

1. In Slack, click **+** next to Channels to create a new channel
2. Name: `ops-alerts`
3. Description: "Real-time alerts for API uptime incidents"
4. Click **Create**

---

## Step 2: Create Slack Incoming Webhook

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps) → Your App → **Incoming Webhooks**
2. Enable Incoming Webhooks
3. Click **Add New Webhook to Workspace**
4. Select `#ops-alerts` as the channel
5. Copy the webhook URL (format: `https://hooks.slack.com/services/XXX/YYY/ZZZ`)

---

## Step 3: Configure UptimeRobot Webhook Alert Contact

1. Log into [uptimerobot.com](https://uptimerobot.com)
2. Go to **Settings** → **Alert Contacts**
3. Click **Add Alert Contact**
4. Type: **Slack (Webhook)**
5. Name: `buywhere-ops-alerts`
6. Paste the Slack webhook URL
7. Save

---

## Step 4: Configure Monitor Alerts

### For api.buywhere.ai monitor

1. Go to **My Monitors** → **api.buywhere.ai**
2. **Alert Contacts**: Select `buywhere-ops-alerts`
3. **Alert interval**: 5 minutes (default)
4. **Status**: Enable

### For buywhere.ai monitor

1. Go to **My Monitors** → **buywhere.ai**
2. **Alert Contacts**: Select `buywhere-ops-alerts`
3. **Alert interval**: 5 minutes (default)
4. **Status**: Enable

---

## Step 5: Configure On-Call @mention

UptimeRobot supports Slack user/group mentions in alert messages using Slack's format.

### Option A: Channel-wide mention (notify everyone)

In the Slack webhook URL, append `?channel=%23ops-alerts` to ensure it posts to the correct channel.

### Option B: On-call engineer mention

1. In UptimeRobot, create a **Custom HTTP Alert** contact type instead of basic webhook
2. Use the Slack Webhook URL with a payload that includes the on-call user's Slack ID:

```json
{
  "text": ":*alert_type*: *monitor_name* is DOWN\nReason: *alert_details*\n<@U01ONCALLID> please investigate.",
  "channel": "#ops-alerts"
}
```

To get a user's Slack ID, enable Slack mode in UptimeRobot settings or use the Slack user ID format `@U01XXX`.

---

## Step 6: Verify Integration

1. In UptimeRobot, click **Test** next to the alert contact
2. Verify a test message appears in `#ops-alerts`
3. Confirm the alert message contains appropriate mention if configured

---

## Alert Message Template

UptimeRobot sends alert payloads with these fields:

| Field | Description |
|-------|-------------|
| `monitor_url` | URL being monitored |
| `monitor_name` | Display name of the monitor |
| `alert_type` | Type of alert (DOWN, UP, SSL_EXPIRY, etc.) |
| `alert_type_code` | Numeric code for alert type |
| `monitor_duration` | How long the monitor has been running |
| `alert_details` | Additional details about the alert |

---

## Response Time SLA

- **Alert fire**: Within 60 seconds of DOWN detection
- **On-call acknowledge**: Within 5 minutes via PagerDuty
- **Escalation**: After 15 minutes to DevOps team
- **Escalation**: After 30 minutes to Bolt (VP DevOps)
- **Escalation**: After 60 minutes to Rex (CTO)

---

## Environment Variables

After setting up the webhook, store the Slack webhook URL securely:

```bash
# In /etc/buywhere/api-healthcheck.env
UPTIMEROBOT_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Alerts not appearing in Slack | Verify webhook URL is correct and channel name is `#ops-alerts` |
| Mention not working | Ensure Slack user ID format is correct (`@U01XXX`) |
| Duplicate alerts | Check UptimeRobot alert interval settings (default 5 min) |
| Monitor shows DOWN but no alert | Verify alert contact is attached to the monitor |

---

## Related Documents

- [Monitoring Runbook](/BUY/issues/BUY-4922#document-monitoring-runbook) — Full monitoring stack documentation
- [BUY-4935](BUY-4935) — This integration issue
- [BUY-4926](BUY-4926) — Root cause: uptime monitoring failure
- [BUY-4921](BUY-4921) — Investigate uptime notification failure