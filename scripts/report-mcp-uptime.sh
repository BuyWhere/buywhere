#!/usr/bin/env bash
# scripts/report-mcp-uptime.sh — Generate uptime metrics from check-mcp-uptime.sh logs (BUY-8992)
# Usage: ./scripts/report-mcp-uptime.sh [output_dir]
#   LOG_FILE — path to the NDJSON log (default: /var/log/buywhere/mcp-uptime.ndjson)
#   OUTPUT_DIR — directory for generated report files (default: /var/www/mcp-uptime or $1)
#   MCP_URL — MCP server URL (default: https://mcp.buywhere.ai)
set -euo pipefail

LOG_FILE="${LOG_FILE:-${LOG_DIR:-/var/log/buywhere}/mcp-uptime.ndjson}"
OUTPUT_DIR="${1:-${OUTPUT_DIR:-/var/www/mcp-uptime}}"
MCP_URL="${MCP_URL:-https://mcp.buywhere.ai}"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ ! -f "$LOG_FILE" ]; then
  echo "ERROR: log file not found: $LOG_FILE" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

python3 - "$LOG_FILE" "$OUTPUT_DIR" "$MCP_URL" <<'PYEOF'
import json, os, sys, statistics
from datetime import datetime, timezone, timedelta

log_file = sys.argv[1]
output_dir = sys.argv[2]
mcp_url = sys.argv[3]

with open(log_file) as f:
  lines = [json.loads(l) for l in f if l.strip()]

if not lines:
  print("ERROR: no data in log file")
  sys.exit(1)

now = datetime.now(timezone.utc)

# Calculate windows
five_min_ago = now - timedelta(minutes=5)
thirty_days_ago = now - timedelta(days=30)

# Filter windows
window_5m = [e for e in lines if datetime.fromisoformat(e["ts"]) >= five_min_ago]
window_30d = [e for e in lines if datetime.fromisoformat(e["ts"]) >= thirty_days_ago]

def calc_metrics(entries, label):
  total = len(entries)
  up = sum(1 for e in entries if e["result"] == "up")
  down = sum(1 for e in entries if e["result"] == "down")
  degraded = sum(1 for e in entries if e["result"] == "degraded")
  uptime_pct = round((up / total * 100), 4) if total > 0 else 0
  error_rate = round((down / total * 100), 4) if total > 0 else 0

  latencies = sorted([e["latency_ms"] for e in entries])
  p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0
  p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0
  avg_latency = round(statistics.mean(latencies), 1) if latencies else 0
  max_latency = max(latencies) if latencies else 0

  return {
    "label": label,
    "total_checks": total,
    "up": up,
    "down": down,
    "degraded": degraded,
    "uptime_pct": uptime_pct,
    "error_rate": error_rate,
    "p95_latency_ms": p95,
    "p99_latency_ms": p99,
    "avg_latency_ms": avg_latency,
    "max_latency_ms": max_latency,
    "window_entries": total
  }

metrics_5m = calc_metrics(window_5m, "5m")
metrics_30d = calc_metrics(window_30d, "30d")

# Latest check
latest = lines[-1]

# Alert if uptime < 99.9% in last 5 minutes
alert = None
if metrics_5m["uptime_pct"] < 99.9 and metrics_5m["total_checks"] >= 3:
  alert = {
    "level": "CRITICAL",
    "message": f"Uptime {metrics_5m['uptime_pct']}% below 99.9% threshold in last 5 minutes",
    "window": "5m",
    "threshold": 99.9,
    "actual": metrics_5m["uptime_pct"]
  }

# Hourly breakdown (last 24h for trend)
hourly_trend = []
for h in range(23, -1, -1):
  hour_start = now - timedelta(hours=h+1)
  hour_end = now - timedelta(hours=h)
  hour_entries = [e for e in lines if hour_start <= datetime.fromisoformat(e["ts"]) < hour_end]
  if hour_entries:
    up = sum(1 for e in hour_entries if e["result"] == "up")
    total = len(hour_entries)
    hourly_trend.append({
      "hour": hour_start.strftime("%Y-%m-%dT%H:00:00Z"),
      "uptime_pct": round(up / total * 100, 2) if total > 0 else 0,
      "checks": total,
      "avg_latency_ms": round(statistics.mean([e["latency_ms"] for e in hour_entries]), 1)
    })

# Latency trend (last 24h in 5-min buckets)
latency_trend = []
for m in range(287, -1, -1):
  bucket_start = now - timedelta(minutes=m+5)
  bucket_end = now - timedelta(minutes=m)
  bucket = [e for e in lines if bucket_start <= datetime.fromisoformat(e["ts"]) < bucket_end]
  if bucket:
    latencies = [e["latency_ms"] for e in bucket]
    latencies.sort()
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0
    latency_trend.append({
      "ts": bucket_start.strftime("%Y-%m-%dT%H:%M:00Z"),
      "p95_ms": p95,
      "avg_ms": round(statistics.mean(latencies), 1),
      "samples": len(bucket)
    })

report = {
  "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
  "mcp_url": mcp_url,
  "latest": latest,
  "metrics_5m": metrics_5m,
  "metrics_30d": metrics_30d,
  "hourly_trend": hourly_trend,
  "latency_trend": latency_trend,
  "alert": alert,
  "status": "alert" if alert else "healthy"
}

# Write report JSON
report_path = os.path.join(output_dir, "uptime.json")
with open(report_path, "w") as f:
  json.dump(report, f, indent=2)

print(f"Report written to {report_path}")
print(f"  30d uptime: {metrics_30d['uptime_pct']}%  | 5m uptime: {metrics_5m['uptime_pct']}%")
print(f"  p95: {metrics_5m['p95_latency_ms']}ms  |  p99: {metrics_5m['p99_latency_ms']}ms  |  avg: {metrics_5m['avg_latency_ms']}ms")
if alert:
  print(f"  ALERT: {alert['message']}")
print(f"  Status: {report['status']}")
PYEOF
