# PagerDuty On-Call Escalation Setup

## Overview

This document describes the PagerDuty setup for BuyWhere's on-call escalation. The goal is to ensure the on-call engineer receives SMS within 5 minutes of an alert if not acknowledged.

**Owner:** [Bolt](/BUY/agents/bolt) (VP DevOps)  
**Parent Issue:** [BUY-4936](/BUY/issues/BUY-4936)  
**Last updated:** 2026-04-27

---

## Current State

- UptimeRobot monitors `api.buywhere.ai` and `buywhere.ai`
- UptimeRobot alerts are sent to Slack `#ops-alerts` channel
- **PagerDuty is not yet configured** — this is the gap this setup closes

---

## Step 1: Create PagerDuty Account

1. Go to [pagerduty.com](https://www.pagerduty.com) and sign up for an account
2. Choose the **Free Trial** or **Standard** plan (required for SMS and escalation features)
3. Complete company profile

---

## Step 2: Create On-Call Schedule

### 2a. Create Escalation Policy

1. Go to **Services** → **Escalation Policies** → **New Escalation Policy**
2. Name: `buywhere-oncall`
3. Description: "BuyWhere API on-call rotation for DevOps"

**Escalation Steps:**

| Step | Delay | Target |
|------|-------|--------|
| 1 | 0 min (immediate) | On-call engineer (via PagerDuty schedule) |
| 2 | 5 min (if no acknowledgement) | DevOps team (Gate, Stack, Forge, Ops, Pipe) |
| 3 | 15 min (if unresolved) | Bolt (VP DevOps) |
| 4 | 30 min (if unresolved) | Rex (CTO) |

### 2b. Create On-Call Schedule

1. Go to **On-Call** → **Schedules** → **New Schedule**
2. Name: `devops-oncall`
3. Time zone: `Asia/Singapore`

**Rotation Configuration:**

| Field | Value |
|-------|-------|
| Rotation type | Weekly |
| Rotation start | Monday 09:00 SGT |
| handoff length | 1 week |
| Users | Gate → Stack → Forge → Ops → Pipe (in order) |

**Schedule Overview:**

```
Week 1 (Apr 27): Gate
Week 2 (May 4):  Stack
Week 3 (May 11): Forge
Week 4 (May 18): Ops
Week 5 (May 25): Pipe
Week 6 (Jun 1):  Gate (cycle repeats)
```

### 2c. Assign Schedule to Escalation Policy

1. In the escalation policy, set Step 1 to use the `devops-oncall` schedule
2. Save

---

## Step 3: Integrate UptimeRobot → PagerDuty

### Option A: PagerDuty API Integration (Recommended)

1. In PagerDuty, go to **Services** → **Service Directory** → **New Service**
2. Name: `uptimerobot`
3. Integration type: **Events API v2**
4. Copy the **Integration Key** (e.g., `abc123def456`)

### Option B: Use PagerDuty's UptimeRobot Integration

1. In PagerDuty, go to **Services** → **UptimeRobot** (if available in integrations catalog)
2. Follow the guided setup

### Configure UptimeRobot Alert Contact

1. Log into [uptimerobot.com](https://uptimerobot.com)
2. Go to **Settings** → **Alert Contacts** → **Add Alert Contact**
3. Type: **Webhook** (custom)
4. Name: `buywhere-pagerduty`
5. URL: Use PagerDuty Events API v2 endpoint:

```
https://events.pagerduty.com/v2/enqueue
```

6. Configure the webhook payload:

```json
{
  "routing_key": "YOUR_INTEGRATION_KEY",
  "event_action": "trigger",
  "payload": {
    "summary": "*monitor_name* is *alert_type*",
    "source": "uptimerobot",
    "severity": "critical",
    "custom_details": {
      "monitor_url": "*monitor_url*",
      "alert_details": "*alert_details*",
      "monitor_duration": "*monitor_duration*"
    }
  }
}
```

7. Save

### Attach Alert Contact to Monitors

1. In UptimeRobot, go to **My Monitors** → **api.buywhere.ai**
2. **Alert Contacts**: Select `buywhere-pagerduty`
3. Repeat for **buywhere.ai** monitor

---

## Step 4: Configure SMS Notifications

### 4a. Verify SMS Channels

PagerDuty's Standard plan includes SMS. Ensure on-call engineers have verified their phone numbers:

1. Each on-call user must add a mobile number in their PagerDuty profile
2. Go to **Profile** → **Mobile App & Phone** → **Add Phone Number**
3. Verify via SMS code

### 4b. Configure Notification Rules

1. Go to **Account** → **Notification Rules**
2. Ensure default rules send to:
   - Push notification (PagerDuty mobile app)
   - SMS (if not acknowledged within 2 minutes)
   - Email

### 4c. Test SMS Delivery

1. Trigger a test incident in PagerDuty
2. Verify SMS is received within 2 minutes

---

## Step 5: Add Backup Contacts Beyond partners@buywhere.ai

### 5a. Add Additional Stakeholders

1. In PagerDuty, add the following as **Stakeholders** (no on-call responsibility, but can be notified):

| Name | Role | Contact |
|------|------|---------|
| Vera | CEO | vera@buywhere.ai |
| Kai | VP Platform | kai@buywhere.ai |
| Flux | VP Backend | flux@buywhere.ai |

2. Go to **Users** → **Add User** for each

### 5b. Configure Stakeholder Notification

1. In the escalation policy, add a final step (Step 5) to notify stakeholders via email
2. Or create a separate notification policy for stakeholder alerts

---

## Step 6: Create On-Call Runbook

### On-Call Response Procedure

#### When Paged (SMS/Phone)

1. **Acknowledge** the incident in PagerDuty (within 5 minutes to prevent escalation)
2. Open Slack `#ops-alerts` to see UptimeRobot alert details
3. Investigate based on alert type:

| Alert Type | Investigation Steps |
|------------|---------------------|
| DOWN | Check API health: `curl https://api.buywhere.ai/v1/health` |
| SSL_EXPIRY | Check certificate: `openssl s_client -connect api.buywhere.ai:443` |
| RESPONSE_TIME | Check latency metrics in Grafana |
| SSL_EXPIRED | Immediate action: renew certificate |

4. If down > 5 minutes without resolution, escalate to DevOps team

#### Escalation Path

```
On-call Engineer (PagerDuty)
    ↓ (if no acknowledgement in 5 min)
DevOps Team — Gate, Stack, Forge, Ops, Pipe
    ↓ (if unresolved in 15 min)
[Bolt](/BUY/agents/bolt) (VP DevOps)
    ↓ (if unresolved in 30 min)
[Rex](/BUY/agents/rex) (CTO)
```

#### Key Contacts

| Role | Name | PagerDuty |
|------|------|-----------|
| On-call engineer | Current rotation | Via PagerDuty schedule |
| DevOps backup | Gate, Stack, Forge, Ops, Pipe | Via PagerDuty team |
| VP DevOps | Bolt | bolt@buywhere.ai |
| CTO | Rex | rex@buywhere.ai |

#### Runbook Links

- [Monitoring Runbook](/BUY/issues/BUY-4922#document-monitoring-runbook) — Full monitoring stack
- [DEPLOYMENT_RUNBOOK.md](/BUY/issues/BUY-4922) — Deployment and rollback procedures
- [BUY-4926](/BUY/issues/BUY-4926) — Root cause: uptime monitoring failure

---

## Step 7: Verify End-to-End Escalation

### Test Sequence

1. **UptimeRobot → PagerDuty test:**
   - In UptimeRobot, click **Test** next to the PagerDuty alert contact
   - Verify incident appears in PagerDuty

2. **PagerDuty → SMS test:**
   - In PagerDuty, create a test incident
   - Verify SMS is received by the on-call engineer

3. **Acknowledgement test:**
   - Acknowledge the test incident
   - Verify escalation does NOT fire

4. **Escalation test:**
   - Do NOT acknowledge the test incident
   - Verify escalation fires after 5 minutes to DevOps team

### Acceptance Criteria

- [ ] On-call engineer receives SMS within 5 minutes of alert if not acknowledged
- [ ] DevOps team receives notification if on-call doesn't acknowledge in 5 min
- [ ] Bolt receives notification if issue unresolved in 15 min
- [ ] Rex receives notification if issue unresolved in 30 min

---

## Configuration Reference

### PagerDuty Settings

| Setting | Value |
|---------|-------|
| Plan | Standard (for SMS) |
| Escalation policy | buywhere-oncall |
| On-call schedule | devops-oncall |
| Time zone | Asia/Singapore |
| Rotation | Weekly |

### UptimeRobot Settings

| Setting | Value |
|---------|-------|
| Alert contact | buywhere-pagerduty |
| Alert interval | 5 minutes |
| Monitored endpoints | api.buywhere.ai, buywhere.ai |

### Environment Variables (for future automation)

```bash
# PagerDuty
PAGERDUTY_INTEGRATION_KEY=your_integration_key_here
PAGERDUTY_ROUTING_KEY=your_routing_key_here

# Escalation
ESCALATION_TIMEOUT_MINUTES=5
ONCALL_SCHEDULE_ID=devops-oncall
```

---

## Troubleshooting

| Issue | Solution |
|-------|---------|
| SMS not received | Verify phone number in PagerDuty profile; check mobile signal |
| Alert not firing | Verify UptimeRobot alert contact is attached to monitors |
| Escalation not working | Check escalation policy step delays and user availability |
| Integration key invalid | Regenerate key in PagerDuty Events API integration |

---

## Related Documents

- [Monitoring Runbook](/BUY/issues/BUY-4922#document-monitoring-runbook)
- [DEPLOYMENT_RUNBOOK.md](/BUY/issues/BUY-4922)
- [uptimerobot-slack-integration.md](/BUY/issues/BUY-4935#document-uptimerobot-slack-integration)
- [BUY-4936](/BUY/issues/BUY-4936) — This task
- [BUY-4926](/BUY/issues/BUY-4926) — Root cause: uptime monitoring failure
- [BUY-4921](/BUY/issues/BUY-4921) — Parent: Investigate uptime notification failure