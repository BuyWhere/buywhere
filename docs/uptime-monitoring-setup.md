# UptimeRobot Uptime Monitoring — BuyWhere API

## Current state (as of 2026-04-20)

| Field | Value |
|-------|-------|
| Account | partners@buywhere.ai |
| Monitor | `api.buywhere.ai health` |
| Monitor ID | 802883470 |
| URL | https://api.buywhere.ai/health |
| Check interval | **5 minutes** (free tier) |
| Status page | http://stats.uptimerobot.com/d9XfakUWga |

## What is done

- Monitor is **live** and checking `/health` every 5 minutes.
- Downtime will be detected within 5 minutes.

## What remains (non-blocking for April 23 launch)

### 1. Upgrade to 1-minute polling (paid plan)

Free tier: 5-minute interval.
Launch requirement: ≤ 1-minute check frequency.

**Action:** Board/Vera to upgrade UptimeRobot account at partners@buywhere.ai to a paid plan.
Once upgraded, update the monitor interval:

1. Log in at https://uptimerobot.com with partners@buywhere.ai
2. Edit monitor `api.buywhere.ai health` (ID: 802883470)
3. Set **Monitoring Interval** → **1 minute**
4. Save

### 2. Wire on-call Slack webhook for downtime alerts

Alerts currently have no notification contact set.

**Action:** Board/Vera to provide the on-call Slack webhook URL, then run:

```bash
# Using UptimeRobot API
UPTIMEROBOT_API_KEY=u3447956-85a3a9447beefab5ac42403e
SLACK_WEBHOOK_URL=https://hooks.slack.com/...

# Create alert contact
curl -X POST https://api.uptimerobot.com/v2/newAlertContact \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "api_key=${UPTIMEROBOT_API_KEY}" \
  --data-urlencode "type=11" \
  --data-urlencode "value=${SLACK_WEBHOOK_URL}" \
  --data-urlencode "friendly_name=BuyWhere On-Call Slack"

# The response includes the alert_contact ID.
# Then update the monitor to use that contact:
# curl -X POST https://api.uptimerobot.com/v2/editMonitor \
#   -H "Content-Type: application/x-www-form-urlencoded" \
#   --data-urlencode "api_key=${UPTIMEROBOT_API_KEY}" \
#   --data-urlencode "id=802883470" \
#   --data-urlencode "alert_contacts=<contact_id>_0_0"
```

## Verification checklist

- [ ] Monitor shows **Up** in UptimeRobot dashboard
- [ ] Check interval = 1 minute (after paid upgrade)
- [ ] Downtime alert fires to on-call Slack channel (after webhook wired)
