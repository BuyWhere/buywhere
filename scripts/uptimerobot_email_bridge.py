#!/usr/bin/env python3
"""Poll the partners inbox for UptimeRobot alert emails and mirror them into Paperclip incidents."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any


AGENTMAIL_BASE_URL = os.environ.get("AGENTMAIL_API_URL", "https://api.agentmail.to/v0").rstrip("/")
AGENTMAIL_API_KEY = os.environ.get("AGENTMAIL_API_KEY", "").strip()
INBOX_ID = os.environ.get("UPTIMEROBOT_EMAIL_BRIDGE_INBOX", "partners@buywhere.ai").strip()

PAPERCLIP_API_URL = os.environ.get("PAPERCLIP_API_URL", "").rstrip("/")
PAPERCLIP_API_KEY = os.environ.get("PAPERCLIP_API_KEY", "").strip()
PAPERCLIP_COMPANY_ID = os.environ.get("PAPERCLIP_COMPANY_ID", "177bc805-e3c8-4336-84cb-8e1e482d5a17").strip()
PAPERCLIP_RUN_ID = os.environ.get("PAPERCLIP_RUN_ID", "").strip()

REX_AGENT_ID = "8ca957f8-0911-4e81-a963-e2cf54c97d44"
PARENT_ISSUE_ID = "79d50257-93fa-43d2-9042-bc14bcafd4b4"  # BUY-13701
GOAL_ID = "2c19e8cc-3e32-4144-8fcb-c4f206cb9fa4"

STATE_PATH = Path("data/uptimerobot_email_bridge_state.json")
PROCESSED_LABEL = "uptimerobot-processed"
MAX_PAGES = 20
PAGE_SIZE = 100


@dataclass
class AlertMessage:
    message_id: str
    timestamp: str
    subject: str
    direction: str
    monitor_name: str
    checked_url: str | None
    root_cause: str | None
    location: str | None
    started_at: str | None
    resolved_at: str | None
    from_header: str


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {
            "schema_version": 1,
            "cursor": None,
            "incidents": {},
            "initialized_at": None,
            "updated_at": None,
        }

    with STATE_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = iso_now()
    tmp_path = STATE_PATH.with_suffix(".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2, sort_keys=True)
        handle.write("\n")
    tmp_path.replace(STATE_PATH)


def json_request(url: str, *, method: str = "GET", headers: dict[str, str] | None = None, payload: dict[str, Any] | None = None) -> Any:
    body = None
    request_headers = dict(headers or {})
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, method=method, headers=request_headers, data=body)
    with urllib.request.urlopen(req, timeout=30) as response:
        raw = response.read()
    if not raw:
        return None
    return json.loads(raw)


def agentmail_request(path: str, *, method: str = "GET", payload: dict[str, Any] | None = None) -> Any:
    if not AGENTMAIL_API_KEY:
        raise RuntimeError("AGENTMAIL_API_KEY is required")
    return json_request(
        f"{AGENTMAIL_BASE_URL}{path}",
        method=method,
        payload=payload,
        headers={"Authorization": f"Bearer {AGENTMAIL_API_KEY}"},
    )


def paperclip_request(path: str, *, method: str = "GET", payload: dict[str, Any] | None = None) -> Any:
    if not PAPERCLIP_API_URL or not PAPERCLIP_API_KEY:
        raise RuntimeError("PAPERCLIP_API_URL and PAPERCLIP_API_KEY are required")
    headers = {"Authorization": f"Bearer {PAPERCLIP_API_KEY}"}
    if method != "GET" and PAPERCLIP_RUN_ID:
        headers["X-Paperclip-Run-Id"] = PAPERCLIP_RUN_ID
    return json_request(f"{PAPERCLIP_API_URL}{path}", method=method, payload=payload, headers=headers)


def clean_html(fragment: str | None) -> str:
    if not fragment:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    text = re.sub(r"</(p|div|h\d|li|tr|table|hr)>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    text = text.replace("\xa0", " ")
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def extract_section_text(html: str, label: str) -> str | None:
    pattern = rf"{re.escape(label)}</div>\s*<h2[^>]*>(.*?)</h2>"
    match = re.search(pattern, html, flags=re.I | re.S)
    if not match:
        return None
    value = clean_html(match.group(1)).strip()
    return value or None


def parse_alert_message(message: dict[str, Any]) -> AlertMessage | None:
    subject = str(message.get("subject") or "").strip()
    from_header = str(message.get("from") or "").strip()
    subject_match = re.match(r"Monitor is (DOWN|UP):\s*(.+)$", subject, flags=re.I)
    if "uptimerobot.com" not in from_header.lower() or not subject_match:
        return None

    direction = subject_match.group(1).upper()
    monitor_name = subject_match.group(2).strip()
    html_body = str(message.get("extracted_html") or message.get("html") or "")
    checked_url = extract_section_text(html_body, "Checked URL")
    root_cause = extract_section_text(html_body, "Root cause")
    location = extract_section_text(html_body, "Location")
    started_at = extract_section_text(html_body, "Incident started at")
    resolved_at = extract_section_text(html_body, "Resolved at") or extract_section_text(html_body, "Incident resolved at")

    return AlertMessage(
        message_id=str(message["message_id"]),
        timestamp=str(message["timestamp"]),
        subject=subject,
        direction=direction,
        monitor_name=monitor_name,
        checked_url=checked_url,
        root_cause=root_cause,
        location=location,
        started_at=started_at,
        resolved_at=resolved_at,
        from_header=from_header,
    )


def list_new_messages(cursor_message_id: str | None) -> list[dict[str, Any]]:
    encoded_inbox = urllib.parse.quote(INBOX_ID, safe="")
    page_token: str | None = None
    found_cursor = cursor_message_id is None
    collected: list[dict[str, Any]] = []

    for _ in range(MAX_PAGES):
        query = {"limit": str(PAGE_SIZE)}
        if page_token:
            query["page_token"] = page_token
        url = f"/inboxes/{encoded_inbox}/messages?{urllib.parse.urlencode(query)}"
        response = agentmail_request(url)
        messages = response.get("messages", [])
        if not messages:
            break

        for message in messages:
            message_id = str(message.get("message_id"))
            if cursor_message_id and message_id == cursor_message_id:
                found_cursor = True
                break
            collected.append(message)

        if found_cursor:
            break
        page_token = response.get("next_page_token")
        if not page_token:
            break

    if cursor_message_id and not found_cursor:
        print(f"warning: cursor message {cursor_message_id} not found in recent pages; treating fetched window as new", file=sys.stderr)

    collected.reverse()
    return collected


def get_message_detail(message_id: str) -> dict[str, Any]:
    encoded_inbox = urllib.parse.quote(INBOX_ID, safe="")
    encoded_message = urllib.parse.quote(message_id, safe="")
    return agentmail_request(f"/inboxes/{encoded_inbox}/messages/{encoded_message}")


def update_message_labels(message_id: str, add_labels: list[str], remove_labels: list[str]) -> None:
    encoded_inbox = urllib.parse.quote(INBOX_ID, safe="")
    encoded_message = urllib.parse.quote(message_id, safe="")
    agentmail_request(
        f"/inboxes/{encoded_inbox}/messages/{encoded_message}",
        method="PATCH",
        payload={"add_labels": add_labels, "remove_labels": remove_labels},
    )


def incident_key(alert: AlertMessage) -> str:
    return alert.monitor_name.strip().lower()


def build_issue_description(alert: AlertMessage, status: str) -> str:
    lines = [
        f"**Service:** {alert.monitor_name}",
        f"**Status:** {status}",
        f"**Alert email time:** {alert.timestamp}",
        f"**Inbox:** {INBOX_ID}",
        f"**Source email:** `{alert.message_id}`",
    ]
    if alert.checked_url:
        lines.append(f"**Check URL:** {alert.checked_url}")
    if alert.root_cause:
        lines.append(f"**Root cause:** {alert.root_cause}")
    if alert.location:
        lines.append(f"**Location:** {alert.location}")
    if alert.started_at:
        lines.append(f"**Incident started at:** {alert.started_at}")
    if alert.resolved_at:
        lines.append(f"**Resolved at:** {alert.resolved_at}")
    return "\n".join(lines)


def create_incident_issue(alert: AlertMessage) -> str:
    payload = {
        "title": f"[INCIDENT] DOWN — {alert.monitor_name}",
        "description": build_issue_description(alert, "DOWN"),
        "status": "todo",
        "priority": "critical",
        "assigneeAgentId": REX_AGENT_ID,
        "parentId": PARENT_ISSUE_ID,
        "goalId": GOAL_ID,
    }
    issue = paperclip_request(f"/api/companies/{PAPERCLIP_COMPANY_ID}/issues", method="POST", payload=payload)
    return str(issue["id"])


def close_incident_issue(issue_id: str, alert: AlertMessage) -> None:
    payload = {
        "status": "done",
        "comment": "\n".join(
            [
                "Resolved via UptimeRobot email bridge.",
                "",
                build_issue_description(alert, "UP"),
            ]
        ),
    }
    paperclip_request(f"/api/issues/{issue_id}", method="PATCH", payload=payload)


def process_alert(state: dict[str, Any], alert: AlertMessage) -> str:
    incidents = state.setdefault("incidents", {})
    key = incident_key(alert)
    active = incidents.get(key)

    if alert.direction == "DOWN":
        if active and active.get("status") == "down" and active.get("issue_id"):
            return f"skipped duplicate DOWN for {alert.monitor_name} (existing issue {active['issue_id']})"
        issue_id = create_incident_issue(alert)
        incidents[key] = {
            "issue_id": issue_id,
            "status": "down",
            "opened_at": iso_now(),
            "last_message_id": alert.message_id,
            "monitor_name": alert.monitor_name,
        }
        return f"created incident {issue_id} for DOWN {alert.monitor_name}"

    if active and active.get("issue_id"):
        close_incident_issue(str(active["issue_id"]), alert)
        incidents[key] = {
            **active,
            "status": "up",
            "closed_at": iso_now(),
            "last_message_id": alert.message_id,
        }
        return f"closed incident {active['issue_id']} for UP {alert.monitor_name}"

    return f"no tracked incident found for UP {alert.monitor_name}"


def initialize_cursor(state: dict[str, Any]) -> dict[str, Any]:
    recent_messages = list_new_messages(None)
    cursor = None
    if recent_messages:
        newest = recent_messages[-1]
        cursor = {
            "message_id": newest.get("message_id"),
            "timestamp": newest.get("timestamp"),
        }
    state["cursor"] = cursor
    state["initialized_at"] = iso_now()
    save_state(state)
    return {
        "mode": "initialized",
        "processed": [],
        "cursor": cursor,
        "message": "state initialized without replaying historical inbox mail",
    }


def main() -> int:
    state = load_state()
    if not state.get("cursor"):
        result = initialize_cursor(state)
        print(json.dumps(result, indent=2))
        return 0

    cursor_message_id = state["cursor"].get("message_id")
    new_messages = list_new_messages(cursor_message_id)
    processed: list[str] = []
    relevant_seen = 0

    for envelope in new_messages:
        message_id = str(envelope.get("message_id"))
        detail = get_message_detail(message_id)
        alert = parse_alert_message(detail)
        if not alert:
            continue
        relevant_seen += 1
        processed.append(process_alert(state, alert))
        update_message_labels(
            message_id,
            add_labels=["read", PROCESSED_LABEL],
            remove_labels=["unread"],
        )

    if new_messages:
        newest = new_messages[-1]
        state["cursor"] = {
            "message_id": newest.get("message_id"),
            "timestamp": newest.get("timestamp"),
        }
    save_state(state)

    print(
        json.dumps(
            {
                "mode": "polled",
                "new_messages": len(new_messages),
                "relevant_alerts": relevant_seen,
                "processed": processed,
                "cursor": state.get("cursor"),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        print(f"HTTP error {exc.code}: {body}", file=sys.stderr)
        raise SystemExit(1)
    except Exception as exc:  # pragma: no cover
        print(f"fatal: {exc}", file=sys.stderr)
        raise SystemExit(1)
