#!/usr/bin/env python3
"""
Add backup stakeholders to PagerDuty.

Stakeholders: Vera (CEO), Kai (VP Platform), Flux (VP Backend)
They are added as users with notification access but no on-call responsibility.

Usage:
    export PAGERDUTY_API_KEY=your_api_key
    python scripts/add_pagerduty_stakeholders.py --dry-run
    python scripts/add_pagerduty_stakeholders.py
"""

import argparse
import http.client
import json
import os
import sys

PAGERDUTY_API_BASE = "api.pagerduty.com"

STAKEHOLDERS = [
    {"name": "Vera", "email": "vera@buywhere.ai", "role": "CEO"},
    {"name": "Kai", "email": "kai@buywhere.ai", "role": "VP Platform"},
    {"name": "Flux", "email": "flux@buywhere.ai", "role": "VP Backend"},
]

def get_api_key():
    key = os.environ.get("PAGERDUTY_API_KEY")
    if not key:
        raise ValueError("PAGERDUTY_API_KEY environment variable is required")
    return key

def api_request(method, path, payload=None):
    api_key = get_api_key()
    conn = http.client.HTTPSConnection(PAGERDUTY_API_BASE)
    headers = {
        "Authorization": f"Token token={api_key}",
        "Content-Type": "application/vnd.pagerduty+json;version=2",
        "Accept": "application/vnd.pagerduty+json;version=2",
    }
    body = json.dumps(payload) if payload else None
    conn.request(method, path, body=body, headers=headers)
    resp = conn.getresponse()
    data = resp.read().decode("utf-8")
    try:
        return resp.status, json.loads(data) if data else {}
    except json.JSONDecodeError:
        return resp.status, {"error": data}

def list_users():
    status, data = api_request("GET", "/users?limit=100")
    if status == 200:
        return {u["email"]: u for u in data.get("users", [])}
    return {}

def create_user(name, email, role):
    payload = {
        "user": {
            "name": name,
            "email": email,
            "role": "limited_user",
        }
    }
    status, data = api_request("POST", "/users", payload)
    return status, data

def add_stakeholders(dry_run=False):
    existing = list_users()
    
    for stakeholder in STAKEHOLDERS:
        email = stakeholder["email"]
        name = stakeholder["name"]
        role = stakeholder["role"]
        
        if email in existing:
            print(f"  ✓ {name} ({role}) already exists: {existing[email]['id']}")
            continue
        
        if dry_run:
            print(f"  [DRY RUN] Would create: {name} ({role}) <{email}>")
            continue
        
        status, data = create_user(name, email, role)
        if status == 201:
            print(f"  ✓ Created {name} ({role}): {data['user']['id']}")
        else:
            print(f"  ✗ Failed to create {name}: {data}")

def main():
    parser = argparse.ArgumentParser(description="Add backup stakeholders to PagerDuty")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be created")
    args = parser.parse_args()
    
    print(f"Adding {len(STAKEHOLDERS)} backup stakeholders to PagerDuty...")
    
    try:
        add_stakeholders(dry_run=args.dry_run)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
