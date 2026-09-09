#!/usr/bin/env python3
"""
MCP Authenticated Endpoint Health Check - BUY-57227

Probes the production MCP endpoint at api.buywhere.ai/mcp with three checks:
1. Server info (GET) - expects JSON with name and protocol
2. tools/list (anonymous POST) - expects result.tools with search_products
3. tools/list (invalid auth POST) - informational, records auth_enforced flag

Results are written to BUY-57227-evidence/ as JSON and a summary report.
"""

import json
import time
import os
import sys
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("ERROR: requests library not installed. pip install requests")
    sys.exit(1)

MCP_BASE = "https://api.buywhere.ai/mcp"
TIMEOUT_SECONDS = 15
EVIDENCE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "BUY-57227-evidence")


def probe_server_info():
    """Probe 1: GET /mcp for server info."""
    result = {
        "probe": "server_info",
        "method": "GET",
        "url": MCP_BASE,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    start = time.monotonic()
    try:
        resp = requests.get(MCP_BASE, timeout=TIMEOUT_SECONDS, headers={"Accept": "application/json"})
        latency_ms = round((time.monotonic() - start) * 1000)
        result["latency_ms"] = latency_ms
        result["http_status"] = resp.status_code
        try:
            body = resp.json()
        except Exception:
            body = None
        result["schema_ok"] = (
            resp.status_code == 200
            and isinstance(body, dict)
            and body.get("name") == "buywhere-catalog"
            and body.get("protocol") == "mcp"
        )
        result["body"] = body
    except Exception as e:
        latency_ms = round((time.monotonic() - start) * 1000)
        result["latency_ms"] = latency_ms
        result["http_status"] = 0
        result["schema_ok"] = False
        result["error"] = str(e)
    result["finished_at"] = datetime.now(timezone.utc).isoformat()
    return result


def probe_tools_list(auth_header=None, label="tools_list_anon"):
    """Probe 2 or 3: POST JSON-RPC tools/list."""
    result = {
        "probe": label,
        "method": "POST",
        "url": MCP_BASE,
        "auth": "none" if auth_header is None else "invalid_bearer",
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if auth_header:
        headers["Authorization"] = auth_header
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
    })
    start = time.monotonic()
    try:
        resp = requests.post(MCP_BASE, data=body, headers=headers, timeout=TIMEOUT_SECONDS)
        latency_ms = round((time.monotonic() - start) * 1000)
        result["latency_ms"] = latency_ms
        result["http_status"] = resp.status_code
        try:
            resp_body = resp.json()
        except Exception:
            resp_body = None
        result["body"] = resp_body

        if label == "tools_list_anon":
            tools = []
            if isinstance(resp_body, dict):
                rpc_result = resp_body.get("result") or {}
                tools = rpc_result.get("tools", []) if isinstance(rpc_result, dict) else []
            result["tool_count"] = len(tools)
            tool_names = [t.get("name") for t in tools if isinstance(t, dict)]
            result["has_search_products"] = "search_products" in tool_names
            result["schema_ok"] = (
                resp.status_code == 200
                and len(tools) > 0
                and "search_products" in tool_names
            )
        else:
            # Invalid auth probe - informational
            auth_enforced = False
            if isinstance(resp_body, dict):
                rpc_error = resp_body.get("error")
                if isinstance(rpc_error, dict) and rpc_error.get("code") == "invalid_api_key":
                    auth_enforced = True
            result["auth_enforced"] = auth_enforced
            result["schema_ok"] = resp.status_code == 200
    except Exception as e:
        latency_ms = round((time.monotonic() - start) * 1000)
        result["latency_ms"] = latency_ms
        result["http_status"] = 0
        result["error"] = str(e)
        result["schema_ok"] = False
    result["finished_at"] = datetime.now(timezone.utc).isoformat()
    return result


def run_health_check():
    """Run all three probes and produce a report."""
    os.makedirs(EVIDENCE_DIR, exist_ok=True)

    print("=" * 60)
    print("MCP Authenticated Endpoint Health Check")
    print(f"Target: {MCP_BASE}")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    # Probe 1: Server info
    print("\n[Probe 1] Server Info (GET /mcp)...")
    p1 = probe_server_info()
    status = "OK" if p1["schema_ok"] else "FAIL"
    print(f"  HTTP {p1.get('http_status', 'ERR')} | {p1.get('latency_ms', '?')}ms | {status}")
    if not p1["schema_ok"]:
        print(f"  Details: {p1.get('body', p1.get('error', 'unknown'))}")

    # Probe 2: tools/list anonymous
    print("\n[Probe 2] tools/list (anonymous)...")
    p2 = probe_tools_list(auth_header=None, label="tools_list_anon")
    status = "OK" if p2.get("schema_ok") else "FAIL"
    print(f"  HTTP {p2.get('http_status', 'ERR')} | {p2.get('latency_ms', '?')}ms | tools={p2.get('tool_count', '?')} | {status}")

    # Probe 3: tools/list with invalid auth
    print("\n[Probe 3] tools/list (invalid auth)...")
    p3 = probe_tools_list(auth_header="Bearer bw_invalid_probe_key", label="tools_list_invalid_auth")
    auth_enforced = p3.get("auth_enforced", None)
    print(f"  HTTP {p3.get('http_status', 'ERR')} | {p3.get('latency_ms', '?')}ms | auth_enforced={auth_enforced}")

    # Summary
    all_ok = p1.get("schema_ok", False) and p2.get("schema_ok", False)
    print("\n" + "-" * 40)
    print("SUMMARY")
    print("-" * 40)
    print(f"  Probe 1 (server info):    {'PASS' if p1.get('schema_ok') else 'FAIL'}")
    print(f"  Probe 2 (tools/list):     {'PASS' if p2.get('schema_ok') else 'FAIL'}")
    print(f"  Probe 3 (auth enforced):  {auth_enforced}")
    print(f"  Overall:                  {'HEALTHY' if all_ok else 'DEGRADED'}")

    # Save evidence
    evidence = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "mcp_endpoint": MCP_BASE,
        "overall_healthy": all_ok,
        "probes": [p1, p2, p3],
    }
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    evidence_path = os.path.join(EVIDENCE_DIR, f"mcp-health-{ts}.json")
    with open(evidence_path, "w") as f:
        json.dump(evidence, f, indent=2, default=str)
    print(f"\nEvidence saved: {evidence_path}")

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(run_health_check())
