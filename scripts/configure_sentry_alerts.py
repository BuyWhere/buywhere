#!/usr/bin/env python3
"""
Sentry Alert Configuration Script

Configures error rate alerts for all Sentry projects including US region.
Run this script after setting up your Sentry projects to create the alerting rules.

Usage:
    SENTRY_API_TOKEN=your_token SENTRY_ENVIRONMENT=production python scripts/configure_sentry_alerts.py

Environment variables required:
    SENTRY_API_TOKEN: Sentry API token with 'alerting:write' scope
    SENTRY_ORG: Sentry organization slug (default: buywhere)
    SENTRY_ENVIRONMENT: Environment name for alert naming (default: production)
"""

import os
import requests
from typing import Optional

SENTRY_API_BASE = "https://sentry.io/api/0"


def get_sentry_headers() -> dict:
    token = os.environ.get("SENTRY_API_TOKEN")
    if not token:
        raise ValueError("SENTRY_API_TOKEN environment variable is required")
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def get_org_slug() -> str:
    return os.environ.get("SENTRY_ORG", "buywhere")


def get_projects(org_slug: str) -> list:
    response = requests.get(
        f"{SENTRY_API_BASE}/organizations/{org_slug}/projects/",
        headers=get_sentry_headers(),
    )
    response.raise_for_status()
    return response.json()


def create_error_rate_alert(
    org_slug: str,
    project_slug: str,
    name: str,
    threshold_per_hour: int,
    environment: Optional[str] = None,
) -> Optional[dict]:
    """
    Create an alert that fires when error count exceeds threshold within an hour.
    Uses Sentry's metric alerts API.
    """
    query = "event.type:error"
    if environment:
        query += f" environment:{environment}"

    alert_rule = {
        "name": name,
        "owner": f"organization:{org_slug}",
        "aggregate": "count()",
        "timeWindow": 60,
        "query": query,
        "thresholdType": 0,
        "resolveThreshold": None,
        "triggers": [
            {
                "label": "critical",
                "thresholdType": 0,
                "alertThreshold": threshold_per_hour,
                "resolveThreshold": None,
                "actions": [],
            },
        ],
    }

    response = requests.post(
        f"{SENTRY_API_BASE}/projects/{org_slug}/{project_slug}/rules/",
        headers=get_sentry_headers(),
        json=alert_rule,
    )

    if response.status_code in (200, 201):
        print(f"Created error rate alert '{name}' for {org_slug}/{project_slug}")
        return response.json()
    else:
        print(f"Failed to create alert '{name}': {response.status_code}")
        print(f"  Response: {response.text}")
        return None


def get_projects_to_configure() -> list[str]:
    """Get list of Sentry project slugs to configure alerts for."""
    return [
        "buywhere-api",
        "buywhere-frontend",
        "buywhere-us-api",
        "buywhere-us-frontend",
    ]


def configure_sentry_alerts():
    """Configure Sentry alerts for all projects."""
    org_slug = get_org_slug()
    environment = os.environ.get("SENTRY_ENVIRONMENT", "production").lower()
    print(f"\nConfiguring Sentry alerts for organization: {org_slug}")
    print(f"Target environment: {environment}\n")

    projects = get_projects(org_slug)
    project_map = {p["slug"]: p for p in projects}

    print(f"Found {len(projects)} projects: {list(project_map.keys())}\n")

    alerts_created = []

    for project_slug in get_projects_to_configure():
        if project_slug not in project_map:
            print(f"Project '{project_slug}' not found in Sentry, skipping...")
            print(f"  Available projects: {list(project_map.keys())}")
            continue

        print(f"\n--- Configuring alerts for {project_slug} ---")

        alert_5_per_hour = create_error_rate_alert(
            org_slug=org_slug,
            project_slug=project_slug,
            name=f"[{environment}] High Error Rate: >5 errors/hour",
            threshold_per_hour=5,
            environment=environment,
        )

        if alert_5_per_hour:
            alerts_created.append(alert_5_per_hour)

    print(f"\nConfiguration complete. Created {len(alerts_created)} alert rules.")
    print("\nNote: Sentry alerts are configured. You may also want to:")
    print("  1. Set up notification integrations (Slack, PagerDuty, etc.) in Sentry UI")
    print("  2. Configure alert routing rules in Sentry Settings > Alerts")
    print("  3. Adjust alert sensitivity based on your traffic patterns")


if __name__ == "__main__":
    configure_sentry_alerts()