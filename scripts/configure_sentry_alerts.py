#!/usr/bin/env python3
"""
Configure Sentry alert rules for BuyWhere API launch-day monitoring.

Creates two issue alert rules in the buywhere/buywhere-api project:
  1. Critical errors → on-call channel within 2 minutes
  2. Error spike (≥10 new events/min) → on-call channel

Prerequisites:
  SENTRY_AUTH_TOKEN  — internal integration token with project:write scope
  SENTRY_ORG         — org slug (default: buywhere)
  SENTRY_PROJECT     — project slug (default: buywhere-api)
  SLACK_WEBHOOK_URL  — on-call Slack webhook (or set via Sentry UI after running)

Usage:
  SENTRY_AUTH_TOKEN=sntrys_... python3 scripts/configure_sentry_alerts.py
"""

import os
import sys
import json
import urllib.request
import urllib.error

ORG = os.environ.get("SENTRY_ORG", "buywhere")
PROJECT = os.environ.get("SENTRY_PROJECT", "buywhere-api")
TOKEN = os.environ.get("SENTRY_AUTH_TOKEN", "")
SLACK_WEBHOOK = os.environ.get("SLACK_WEBHOOK_URL", "")

BASE = f"https://sentry.io/api/0/projects/{ORG}/{PROJECT}"


def sentry_request(method: str, path: str, body: dict | None = None):
    if not TOKEN:
        print("ERROR: SENTRY_AUTH_TOKEN is required", file=sys.stderr)
        sys.exit(1)
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} {method} {url}: {e.read().decode()}", file=sys.stderr)
        raise


def create_alert_rule(rule: dict) -> dict:
    return sentry_request("POST", "/alert-rules/", rule)


def main():
    print(f"Configuring Sentry alerts for {ORG}/{PROJECT} ...")

    # Rule 1: Any new error → immediate alert (triggers on first event)
    # "2 minute" SLO: Sentry fires on first event occurrence, delivery via webhook is near-instant
    critical_rule = {
        "name": "BuyWhere API — New error alert (on-call)",
        "actionMatch": "any",
        "filterMatch": "any",
        "conditions": [
            {"id": "sentry.rules.conditions.first_seen_event.FirstSeenEventCondition"},
            {"id": "sentry.rules.conditions.regression_event.RegressionEventCondition"},
        ],
        "filters": [],
        "actions": [
            {
                "id": "sentry.rules.actions.notify_event_service.NotifyEventServiceAction",
                "service": "slack",
                **({"url": SLACK_WEBHOOK} if SLACK_WEBHOOK else {}),
            }
        ],
        "frequency": 2,  # minutes between repeat alerts for same issue
        "environment": "production",
    }

    # Rule 2: Error spike — ≥10 events in 1 minute
    spike_rule = {
        "name": "BuyWhere API — Error spike (≥10 events/min)",
        "actionMatch": "any",
        "filterMatch": "any",
        "conditions": [
            {
                "id": "sentry.rules.conditions.event_frequency.EventFrequencyCondition",
                "value": 10,
                "comparisonType": "count",
                "interval": "1m",
            }
        ],
        "filters": [],
        "actions": [
            {
                "id": "sentry.rules.actions.notify_event_service.NotifyEventServiceAction",
                "service": "slack",
                **({"url": SLACK_WEBHOOK} if SLACK_WEBHOOK else {}),
            }
        ],
        "frequency": 5,
        "environment": "production",
    }

    for rule in [critical_rule, spike_rule]:
        result = create_alert_rule(rule)
        print(f"  Created: [{result['id']}] {result['name']}")

    print("\nDone. Verify alert routing at: https://sentry.io/organizations/buywhere/alerts/rules/")
    if not SLACK_WEBHOOK:
        print("\nWARNING: SLACK_WEBHOOK_URL not set — alerts created but Slack delivery not wired.")
        print("  Set the webhook in Sentry UI: Settings → Integrations → Slack → buywhere-oncall")


if __name__ == "__main__":
    main()
