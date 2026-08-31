# Load Test Report — smoke (2026-08-08T00:29:50.395Z)

- **Target**: https://api.buywhere.ai
- **MCP URL**: https://api.buywhere.ai/mcp
- **Profile**: `smoke` — 10s ramp / 30s hold @ 5 RPS / 10s drain
- **Product IDs seeded**: 6
- **Total requests**: 194 (0 ok, 194 errors)
- **Error rate**: 100.00% (threshold: 5.0%)

## Per-scenario latency (ms) — measured on hold-stage samples

| Scenario | Count | p50 | p95 | p99 | max | holdP95 | holdP99 | Pass |
|----------|------:|----:|----:|----:|----:|--------:|--------:|:----:|
| search | 92 | 6.61 | 16.72 | 116.21 | 116.21 | 10.38 | 116.21 | ✅ |
| product | 48 | 6.82 | 11.25 | 44.46 | 44.46 | 11.39 | 44.46 | ✅ |
| mcp | 54 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | ✅ |

## Status code distribution

### search
- `401`: 92

### product
- `401`: 48

### mcp
- `401`: 54

## Per-stage request counts

| Stage | Requests |
|-------|---------:|
| rampUp | 24 |
| hold | 146 |
| rampDown | 24 |

## Verdict

- p99 < 1000ms: ✅ PASS
- error rate < 5.0%: ❌ FAIL
- **Overall**: ❌ FAIL