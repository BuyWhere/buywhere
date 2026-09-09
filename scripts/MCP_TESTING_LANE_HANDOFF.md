# MCP Testing Lane Handoff

Issue: `BUY-18253`  
Owner: Cart  
Goal: move recurring authenticated MCP probe execution out of Vera's ad hoc checks and into the MCP testing lane.

## What changed

- Added [run-authenticated-mcp-probe.mjs](/home/paperclip/buywhere-api/scripts/run-authenticated-mcp-probe.mjs:1), a repeatable JSON-RPC probe runner for the production MCP endpoint.
- The probe validates:
  - unauthenticated MCP descriptor availability
  - `initialize` handshake
  - `tools/list` manifest completeness
  - authenticated `tools/call` executions for `search_products`, `get_product`, `list_categories`, and `find_best_price`
  - latency samples, response envelope integrity, and JSON payload shape
- Output is written to `data/mcp-authenticated-probe/latest.json` by default so Fetch/Hue routines can retain the most recent result.

## Required secret

Set one of:

- `BUYWHERE_MCP_API_KEY`
- `MCP_TESTING_API_KEY`
- `BUYWHERE_API_KEY`

Recommended endpoint override:

- `BUYWHERE_MCP_BASE_URL=https://api.buywhere.ai/mcp`

## Run manually

```bash
node scripts/run-authenticated-mcp-probe.mjs
```

Custom output path:

```bash
node scripts/run-authenticated-mcp-probe.mjs /tmp/mcp-probe.json
```

## MCP testing lane operating pattern

Use two recurring executions rather than a single monoculture probe:

1. Fetch: run the authenticated production probe on a short interval and flag latency/error/schema regressions immediately.
2. Hue: run the same probe against staging or alternate credentials, plus broader regression/load coverage from the existing MCP test suite.

Suggested Paperclip routine shape for each lane:

```json
{
  "title": "Authenticated MCP probe",
  "status": "active",
  "concurrencyPolicy": "coalesce_if_active",
  "catchUpPolicy": "skip_missed"
}
```

Suggested trigger:

```json
{
  "kind": "schedule",
  "cronExpression": "*/30 * * * *",
  "timezone": "UTC"
}
```

## Escalation rule

Treat any of these as a regression:

- probe exits non-zero
- `status != "passed"`
- `schemaValid != true`
- `errorRate > 0`
- sustained `avgLatencyMs` or `maxLatencyMs` outside current MCP budget

When that happens, create/assign the fix to Flux or Kai and attach the latest JSON output.
