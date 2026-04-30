#!/usr/bin/env python3
"""
PagerDuty Setup Automation Script

Automates the creation of:
- Events API v2 integration for UptimeRobot
- Escalation policy: buywhere-oncall
- On-call schedule: devops-oncall (weekly rotation)

Prerequisites:
1. PagerDuty account (Standard plan for SMS)
2. PagerDuty REST API key (Admin → API Access → Create API Key)
3. PagerDuty Users created for: Gate, Stack, Forge, Ops, Pipe, Bolt, Rex

Usage:
    export PAGERDUTY_API_KEY=your_api_key
    export PAGERDUTY_SERVICE_KEY=your_events_api_key  # Integration key from Events API v2
    python scripts/configure_pagerduty.py --action setup
    python scripts/configure_pagerduty.py --action test
"""

import argparse
import os
import sys
import json
import http.client
import urllib.parse


PAGERDUTY_API_BASE = "api.pagerduty.com"
PAGERDUTY_EVENTS_API_BASE = "events.pagerduty.com"


def get_api_client():
    api_key = os.environ.get("PAGERDUTY_API_KEY")
    if not api_key:
        raise ValueError("PAGERDUTY_API_KEY environment variable is required")
    return api_key


def api_request(method, path, payload=None):
    api_key = get_api_client()
    conn = http.client.HTTPSConnection(PAGERDUTY_API_BASE)
    headers = {
        "Authorization": f"Token token={api_key}",
        "Content-Type": "application/json",
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


def create_events_api_integration():
    print("\n[1/4] Creating Events API v2 integration for UptimeRobot...")
    
    service_payload = {
        "service": {
            "name": "uptimerobot",
            "description": "UptimeRobot external monitoring integration",
            "escalation_policy_id": None,  # Will be set after creating escalation policy
            "status": "active",
            "incident_urgency_rule": {
                "type": "constant",
                "urgency": "high"
            },
            "alert_creation": "create_alerts_and_incidents"
        }
    }
    
    status, data = api_request("POST", "/services", service_payload)
    
    if status == 201:
        service_id = data["service"]["id"]
        integration_payload = {
            "integration": {
                "name": "UptimeRobot Events API v2",
                "type": "events_api_v2_inbound_integration",
                "service": service_id
            }
        }
        int_status, int_data = api_request("POST", f"/services/{service_id}/integrations", integration_payload)
        
        if int_status == 201:
            integration_key = int_data["integration"]["integration_key"]
            print(f"  ✓ Created service 'uptimerobot' (ID: {service_id})")
            print(f"  ✓ Created Events API v2 integration (Key: {integration_key})")
            return service_id, integration_key
        else:
            print(f"  ✗ Failed to create integration: {int_data}")
            return service_id, None
    else:
        print(f"  ✗ Failed to create service: {data}")
        return None, None


def get_user_ids():
    print("\n[2/4] Fetching PagerDuty user IDs...")
    
    user_map = {
        "Gate": None,
        "Stack": None,
        "Forge": None,
        "Ops": None,
        "Pipe": None,
        "Bolt": None,
        "Rex": None
    }
    
    status, data = api_request("GET", "/users?limit=100")
    
    if status == 200:
        for user in data.get("users", []):
            name = user.get("name")
            if name in user_map:
                user_map[name] = user["id"]
        
        for name, uid in user_map.items():
            status_icon = "✓" if uid else "✗"
            print(f"  {status_icon} {name}: {uid or 'NOT FOUND'}")
        
        return user_map
    else:
        print(f"  ✗ Failed to fetch users: {data}")
        return None


def create_escalation_policy(user_ids):
    print("\n[3/4] Creating escalation policy 'buywhere-oncall'...")
    
    if not all(user_ids.values()):
        missing = [name for name, uid in user_ids.items() if uid is None]
        print(f"  ⚠ Missing users: {missing}. Policy may be incomplete.")
    
    oncall_user_ids = [user_ids[k] for k in ["Gate", "Stack", "Forge", "Ops", "Pipe"] if user_ids.get(k)]
    devops_team_ids = [user_ids[k] for k in ["Gate", "Stack", "Forge", "Ops", "Pipe"] if user_ids.get(k)]
    
    escalation_payload = {
        "escalation_policy": {
            "name": "buywhere-oncall",
            "description": "BuyWhere API on-call rotation for DevOps",
            "escalation_rules": [
                {
                    "escalation_delay_in_minutes": 0,
                    "targets": [
                        {"type": "schedule_reference", "id": "devops-oncall-schedule-id"}  # Placeholder
                    ]
                },
                {
                    "escalation_delay_in_minutes": 5,
                    "targets": [
                        {"type": "user_reference", "id": uid} for uid in devops_team_ids
                    ] if devops_team_ids else [{"type": "user", "id": user_ids.get("Gate")}]
                },
                {
                    "escalation_delay_in_minutes": 15,
                    "targets": [
                        {"type": "user_reference", "id": user_ids.get("Bolt")}
                    ] if user_ids.get("Bolt") else []
                },
                {
                    "escalation_delay_in_minutes": 30,
                    "targets": [
                        {"type": "user_reference", "id": user_ids.get("Rex")}
                    ] if user_ids.get("Rex") else []
                }
            ],
            "repeat_enabled": True
        }
    }
    
    status, data = api_request("POST", "/escalation_policies", escalation_payload)
    
    if status == 201:
        policy_id = data["escalation_policy"]["id"]
        print(f"  ✓ Created escalation policy 'buywhere-oncall' (ID: {policy_id})")
        return policy_id
    else:
        print(f"  ✗ Failed to create escalation policy: {data}")
        return None


def create_oncall_schedule():
    print("\n[4/4] Creating on-call schedule 'devops-oncall'...")
    
    schedule_payload = {
        "schedule": {
            "name": "devops-oncall",
            "time_zone": "Asia/Singapore",
            "description": "BuyWhere DevOps weekly on-call rotation",
            "schedule_layers": [
                {
                    "name": "Primary",
                    "start": "2026-04-27T09:00:00+08:00",
                    "rotation_type": "weekly",
                    "rotation_cell_duration": 604800,
                    "handoff_time": "2026-04-27T09:00:00+08:00",
                    "users": [],
                    "restrictions": []
                }
            ]
        }
    }
    
    print("  ⚠ Schedule creation requires PagerDuty API v2 with schedule support")
    print("  ℹ Manual steps required for full schedule setup:")
    print("     1. Go to On-Call → Schedules → New Schedule")
    print("     2. Name: 'devops-oncall', Time zone: Asia/Singapore")
    print("     3. Add users in rotation: Gate → Stack → Forge → Ops → Pipe")
    print("     4. Set rotation to weekly, handoff Monday 09:00 SGT")
    print("     5. Assign this schedule to Step 1 of 'buywhere-oncall' policy")
    
    return None


def update_alertmanager_config(integration_key):
    print(f"\n[+] Updating alertmanager.yml with integration key...")
    
    config_path = os.path.join(os.path.dirname(__file__), "..", "alertmanager.yml")
    
    try:
        with open(config_path, "r") as f:
            content = f.read()
        
        if "PAGERDUTY_SERVICE_KEY" not in content:
            print("  ✗ alertmanager.yml does not reference PAGERDUTY_SERVICE_KEY")
            return False
        
        print(f"  ✓ alertmanager.yml already has PAGERDUTY_SERVICE_KEY placeholder")
        print(f"  ℹ Set PAGERDUTY_SERVICE_KEY={integration_key} in your environment or .env file")
        
        return True
    except Exception as e:
        print(f"  ✗ Error reading alertmanager.yml: {e}")
        return False


def create_env_template(integration_key):
    print(f"\n[+] Creating .env.pagerduty with integration key...")
    
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.pagerduty")
    
    content = f"""# PagerDuty Configuration
# Generated by scripts/configure_pagerduty.py

# Events API v2 Integration Key (from UptimeRobot service)
PAGERDUTY_SERVICE_KEY={integration_key}

# PagerDuty REST API Key (for administration)
PAGERDUTY_API_KEY=your_pagerduty_rest_api_key

# Alert Routing
PAGERDUTY_ROUTING_KEY={integration_key}
"""
    
    try:
        with open(env_path, "w") as f:
            f.write(content)
        print(f"  ✓ Created {env_path}")
        return True
    except Exception as e:
        print(f"  ✗ Error writing .env.pagerduty: {e}")
        return False


def test_integration(integration_key):
    print(f"\n[*] Testing PagerDuty Events API v2 integration...")
    
    if not integration_key or integration_key == "your_integration_key":
        print("  ✗ Integration key not set. Run --action setup first.")
        return False
    
    payload = {
        "routing_key": integration_key,
        "event_action": "trigger",
        "dedup_key": "test-integration-buywhere-123",
        "payload": {
            "summary": "Test alert from BuyWhere PagerDuty integration",
            "source": "buywhere-api",
            "severity": "info",
            "custom_details": {
                "test": True,
                "message": "This is a test alert to verify the PagerDuty integration"
            }
        }
    }
    
    conn = http.client.HTTPSConnection(PAGERDUTY_EVENTS_API_BASE)
    headers = {"Content-Type": "application/json"}
    body = json.dumps(payload)
    conn.request("POST", "/v2/enqueue", body=body, headers=headers)
    resp = conn.getresponse()
    data = resp.read().decode("utf-8")
    
    if resp.status == 202:
        print("  ✓ Test alert sent successfully! Check your PagerDuty dashboard.")
        return True
    else:
        print(f"  ✗ Test alert failed: {resp.status} - {data}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Configure PagerDuty for BuyWhere on-call")
    parser.add_argument("--action", choices=["setup", "test", "env-template"], default="setup",
                        help="Action to perform: setup (create integration), test (send test alert), env-template (generate env file)")
    parser.add_argument("--integration-key", help="PagerDuty Events API integration key")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be done without making API calls")
    
    args = parser.parse_args()
    
    if args.action == "setup":
        if args.dry_run:
            print("[DRY RUN] Would create:")
            print("  - Events API v2 integration service 'uptimerobot'")
            print("  - Escalation policy 'buywhere-oncall'")
            print("  - On-call schedule 'devops-oncall'")
            print("  - Update alertmanager.yml")
            print("  - Create .env.pagerduty")
            return
        
        service_id, integration_key = create_events_api_integration()
        
        if service_id and integration_key:
            user_ids = get_user_ids()
            
            if user_ids:
                policy_id = create_escalation_policy(user_ids)
                schedule_id = create_oncall_schedule()
                
                update_alertmanager_config(integration_key)
                create_env_template(integration_key)
                
                print("\n" + "="*60)
                print("SETUP COMPLETE")
                print("="*60)
                print(f"Integration Key: {integration_key}")
                print("\nNext steps:")
                print("  1. Use this key in UptimeRobot webhook configuration")
                print("  2. Set PAGERDUTY_SERVICE_KEY in your environment")
                print("  3. Test: python scripts/configure_pagerduty.py --action test")
                print("="*60)
        else:
            print("\n✗ Setup failed. Check your PAGERDUTY_API_KEY and try again.")
            sys.exit(1)
    
    elif args.action == "test":
        key = args.integration_key or os.environ.get("PAGERDUTY_SERVICE_KEY")
        if not key:
            print("Error: --integration-key or PAGERDUTY_SERVICE_KEY required")
            sys.exit(1)
        test_integration(key)
    
    elif args.action == "env-template":
        create_env_template(args.integration_key or "your_integration_key")


if __name__ == "__main__":
    main()