#!/usr/bin/env python3
"""
MCP Authenticated Endpoint Health Check (BUY-57244)
Probes production MCP endpoint at api.buywhere.ai/mcp.
Three probes: server info GET, anonymous tools/list POST, invalid-auth tools/list POST.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

MCP_URL = os.environ.get('MCP_URL', 'https://api.buywhere.ai/mcp')
INVALID_KEY = 'bw_invalid_probe_key'
OUTPUT_DIR = os.environ.get('OUTPUT_DIR', 'data/mcp-health-probe')

def probe_server_info(url):
    """Probe 1: GET server info — expect 200, name=buywhere-catalog, protocol=mcp"""
    result = {'name': 'server_info', 'http_status': None, 'latency_ms': None, 'schema_ok': False}
    try:
        req = urllib.request.Request(url, method='GET', headers={'Accept': 'application/json'})
        start = time.monotonic()
        with urllib.request.urlopen(req, timeout=15) as resp:
            latency = (time.monotonic() - start) * 1000
            body = json.loads(resp.read().decode())
            result['http_status'] = resp.status
            result['latency_ms'] = round(latency, 1)
            result['schema_ok'] = (
                body.get('name') == 'buywhere-catalog' and body.get('protocol') == 'mcp'
            )
    except Exception as e:
        result['error'] = str(e)
    return result

def probe_tools_list(url, auth_token=None):
    """Probe 2 & 3: POST tools/list JSON-RPC. Returns result dict."""
    result = {'http_status': None, 'latency_ms': None, 'tool_count': 0, 'schema_ok': False, 'auth_enforced': None}
    body_payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).encode()
    headers = {'Content-Type': 'application/json'}
    if auth_token:
        headers['Authorization'] = f'Bearer {auth_token}'
    try:
        req = urllib.request.Request(url, data=body_payload, headers=headers, method='POST')
        start = time.monotonic()
        with urllib.request.urlopen(req, timeout=15) as resp:
            latency = (time.monotonic() - start) * 1000
            body = json.loads(resp.read().decode())
            result['http_status'] = resp.status
            result['latency_ms'] = round(latency, 1)
            result['schema_ok'] = body.get('jsonrpc') == '2.0' and body.get('id') == 1
            if 'error' in body:
                result['auth_enforced'] = body['error'].get('code') == 'invalid_api_key'
                result['tool_count'] = 0
            else:
                tools = body.get('result', {}).get('tools', [])
                result['tool_count'] = len(tools)
                result['schema_ok'] = result['schema_ok'] and any(t.get('name') == 'search_products' for t in tools)
    except urllib.error.HTTPError as e:
        result['http_status'] = e.code
        try:
            body = json.loads(e.read().decode())
            if 'error' in body:
                result['auth_enforced'] = body['error'].get('code') == 'invalid_api_key'
        except Exception:
            pass
        result['error'] = f'HTTP {e.code}'
    except Exception as e:
        result['error'] = str(e)
    return result

def run():
    ts = datetime.now(timezone.utc).isoformat()
    probes = []

    # Probe 1: Server info GET
    result = probe_server_info(MCP_URL)
    result['name'] = 'server_info'
    probes.append(result)

    # Probe 2: Anonymous tools/list POST
    r2 = probe_tools_list(MCP_URL)
    r2['name'] = 'tools_list_anonymous'
    probes.append(r2)

    # Probe 3: Invalid auth tools/list POST
    r3 = probe_tools_list(MCP_URL, auth_token=INVALID_KEY)
    r3['name'] = 'tools_list_invalid_auth'
    probes.append(r3)

    overall = all(p.get('schema_ok', False) or p.get('name') == 'tools_list_invalid_auth' for p in probes)
    status = 'passed' if overall else 'degraded'

    summary = {
        'probe': 'buywhere-mcp-health',
        'timestamp': ts,
        'base_url': MCP_URL,
        'status': status,
        'probes': probes,
    }

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    out_path = os.path.join(OUTPUT_DIR, 'latest.json')
    with open(out_path, 'w') as f:
        json.dump(summary, f, indent=2)

    print(json.dumps(summary, indent=2))
    return 0 if status == 'passed' else 1

if __name__ == '__main__':
    sys.exit(run())
