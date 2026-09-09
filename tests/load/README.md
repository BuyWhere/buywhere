# BuyWhere Load-Test Harness — BUY-26143 / BUY-579E

Staged load scripts for search, product detail, and MCP query mixes.

## Overview

The harness drives an open-model load generator with three traffic
families against a target API + MCP stack:

| Family     | Endpoint                                              | What it tests |
|------------|-------------------------------------------------------|---------------|
| **search** | `GET /v1/products/search?q=...&country_code=SG`       | FTS path with Redis cache mix |
| **product**| `GET /v1/products/:id`                                | Cache-heavy product detail path |
| **mcp**    | `POST /mcp` (JSON-RPC `tools/call`)                   | MCP server under agent traffic |

The MCP mix is internally weighted across the five primary tools an
agent would actually call:

| Sub-scenario    | Tool               | Weight |
|-----------------|--------------------|-------:|
| `mcpSearch`     | `search_products`  | 50%    |
| `mcpProduct`    | `get_product`      | 25%    |
| `mcpFindBest`   | `find_best_price`  | 10%    |
| `mcpDeals`      | `get_deals`        | 10%    |
| `mcpCategories` | `list_categories`  |  5%    |

The top-level mix across the three families defaults to 40% search /
30% product / 30% MCP, mirroring an agent-fleet production mix.

## Stages

The harness runs in three stages:

1. **Ramp-up** — linear 0 → target RPS over `RAMP_UP` seconds.
2. **Hold** — steady target RPS for `DURATION` seconds. **This is the
   measurement window.** Threshold evaluation (p99, error rate) only
   looks at hold-stage samples, so ramp-up cold-cache spikes don't
   poison the verdict.
3. **Ramp-down** — linear target RPS → 0 over `RAMP_DOWN` seconds.
   Excluded from measurements.

## Profiles

| Profile  | Target RPS | Hold | Use case                          |
|----------|-----------:|-----:|-----------------------------------|
| `smoke`  | 5          | 30s  | Local sanity / PR CI              |
| `normal` | 50         | 4m   | Baseline traffic mix              |
| `peak`   | 200        | 9m   | Daily-peak traffic (target)       |
| `stress` | 1000       | 10m  | Cloud Run autoscaling ceiling     |

## Usage

### Single profile

```bash
# Smoke test against prod (no auth → MCP will 401, expected)
node tests/load/load-harness.mjs

# Authenticated peak test against staging
API_KEY=bw_xxx \
TARGET_URL=https://buywhere-api-staging.run.app \
PROFILE=peak \
node tests/load/load-harness.mjs
```

### Full suite

```bash
PROFILES="smoke peak stress" \
TARGET_URL=https://buywhere-api-staging.run.app \
API_KEY=bw_xxx \
./tests/load/run-load-suite.sh
```

### Environment variables

| Variable             | Default                       | Notes |
|----------------------|-------------------------------|-------|
| `TARGET_URL`         | `https://api.buywhere.ai`     | API base |
| `MCP_URL`            | `${TARGET_URL}/mcp`           | Override MCP endpoint |
| `API_KEY`            | _(unset)_                     | Required for non-401 runs |
| `PROFILE`            | `smoke`                       | One of smoke / normal / peak / stress |
| `DURATION`           | _profile default_             | Override hold seconds |
| `RAMP_UP`            | _profile default_             | Override ramp-up seconds |
| `RAMP_DOWN`          | _profile default_             | Override ramp-down seconds |
| `TARGET_RPS`         | _profile default_             | Override target RPS |
| `OUTPUT_DIR`         | `./load-results`              | Where reports land |
| `WARMUP_QUERIES`     | `12`                          | Queries seeded during catalog warmup |
| `SCENARIO_MIX`       | _profile default_             | JSON, e.g. `'{"search":0.5,"product":0.2,"mcp":0.3}'` |
| `THRESHOLD_P99_MS`   | `1000`                        | Per-scenario hold-p99 ceiling |
| `THRESHOLD_ERROR_RATE` | `0.05`                      | Overall error-rate ceiling |
| `VERBOSE`            | `false`                       | Log every request (very noisy) |

## Outputs

The harness writes two files to `OUTPUT_DIR`:

- `load-summary.json` — full per-scenario and per-stage metrics
  suitable for CI artifacts and dashboards.
- `load-summary.md`   — human-readable markdown report ready to
  paste into an issue comment.

The runner script (`run-load-suite.sh`) produces a per-run `INDEX.md`
summary table covering all profiles executed.

## Exit codes

- `0` — all thresholds pass
- `1` — at least one threshold fails (p99 or error rate)
- `2` — harness crashed (config error, missing files, etc.)

## Why a custom harness (vs k6)?

The repo already has `scripts/k6-load-test.js` and
`tests/load/staging-load-test.js` for k6 users. This harness exists
because:

1. **Zero install** — runs on Node 20+ stdlib only; no `k6` binary
   required in the container or CI image.
2. **MCP-native** — none of the k6 scripts exercise the JSON-RPC
   `tools/call` path that agent traffic actually hits.
3. **Staged thresholding** — measures only the hold stage so cold
   cache during ramp-up doesn't poison verdicts.
4. **Self-contained JSON+MD reports** — drops artifacts directly
   suitable for the `outputs/` directory used by our issue reports.

## Files

- `load-harness.mjs` — main harness (Node, ESM, no deps)
- `run-load-suite.sh` — multi-profile runner
- `staging-load-test.js` — k6 variant for parity testing
- `openai-function-calling-latency.mjs` — single-shot latency gate
  (different concern: per-endpoint SLA validation, not staged load)
