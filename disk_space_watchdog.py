#!/usr/bin/env python3
"""
Disk Space Watchdog (BUY-48198)
Monitors /dev/vda1 free space and creates a critical Paperclip incident when below 5GB.
Warns at 20GB. Designed to run every 5 minutes via cron or systemd timer.
"""

import subprocess
import os
import sys
import requests
from datetime import datetime, timezone

# Thresholds
WARN_GB = 20
CRIT_GB = 5

# Paperclip API
PAPERCLIP_API_URL = os.environ.get("PAPERCLIP_API_URL", "")
PAPERCLIP_API_KEY = os.environ.get("PAPERCLIP_API_KEY", "")
PAPERCLIP_COMPANY_ID = os.environ.get("PAPERCLIP_COMPANY_ID", "")
PAPERCLIP_RUN_ID = os.environ.get("PAPERCLIP_RUN_ID", "")


def get_free_space_gb(path="/"):
    """Return free space in GB for the given filesystem path."""
    try:
        st = os.statvfs(path)
        free_gb = st.f_bavail * st.f_frsize / (1024 ** 3)
        return free_gb
    except Exception as e:
        print(f"[{now()}] ERROR: Could not stat {path}: {e}")
        return None


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%dT%H:%M:%SZ")


def create_paperclip_incident(title, description, severity="critical"):
    """Create a Paperclip incident issue via the API."""
    if not all([PAPERCLIP_API_URL, PAPERCLIP_API_KEY, PAPERCLIP_COMPANY_ID]):
        print(f"[{now()}] WARN: Paperclip credentials not configured; skipping incident creation.")
        return False

    url = f"{PAPERCLIP_API_URL}/api/companies/{PAPERCLIP_COMPANY_ID}/issues"
    headers = {
        "Authorization": f"Bearer {PAPERCLIP_API_KEY}",
        "Content-Type": "application/json",
    }
    if PAPERCLIP_RUN_ID:
        headers["X-Paperclip-Run-Id"] = PAPERCLIP_RUN_ID

    payload = {
        "title": title,
        "description": description,
        "severity": severity,
    }

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=15)
        if resp.status_code in (200, 201):
            print(f"[{now()}] Created Paperclip incident: {resp.json().get('id', 'unknown')}")
            return True
        else:
            print(f"[{now()}] ERROR: Failed to create incident ({resp.status_code}): {resp.text}")
            return False
    except Exception as e:
        print(f"[{now()}] ERROR: Exception creating incident: {e}")
        return False


def main():
    free_gb = get_free_space_gb("/")
    if free_gb is None:
        sys.exit(1)

    print(f"[{now()}] Disk free space: {free_gb:.2f} GB")

    if free_gb < CRIT_GB:
        msg = (
            f"Critical disk space on /dev/vda1: only {free_gb:.2f} GB free "
            f"(threshold: {CRIT_GB} GB)."
        )
        print(f"[{now()}] CRITICAL: {msg}")
        create_paperclip_incident(
            title=f"CRITICAL: Disk space low ({free_gb:.1f} GB free)",
            description=msg,
            severity="critical",
        )
    elif free_gb < WARN_GB:
        print(f"[{now()}] WARNING: Disk space below {WARN_GB} GB ({free_gb:.2f} GB free)")
    else:
        print(f"[{now()}] OK: Disk space healthy ({free_gb:.2f} GB free)")


if __name__ == "__main__":
    main()
