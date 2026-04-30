#!/usr/bin/env python3
"""
API health check monitor for BuyWhere.

Runs lightweight availability checks against `/v1/search` and `/v1/products`,
records daily latency and uptime state, prints WARN lines for 5xx responses or
P99 latency regressions, and can optionally fan alerts out to a webhook.

Example systemd timer cadence:
    * * * * * cd /home/paperclip/buywhere-api && python3 scripts/healthcheck.py --once
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


DEFAULT_BASE_URL = "https://api.buywhere.ai"
DEFAULT_DATA_DIR = Path("/home/paperclip/buywhere-api/logs/healthcheck")
DEFAULT_TIMEOUT_SECONDS = 20.0
DEFAULT_ALERT_COOLDOWN_SECONDS = 15 * 60
DEFAULT_P99_WARN_MS = 500.0


@dataclass(frozen=True)
class EndpointCheck:
    name: str
    path: str
    params: dict[str, str]


@dataclass
class CheckResult:
    endpoint: str
    path: str
    status_code: int | None
    latency_ms: float
    result_count: int | None
    ok: bool
    error: str | None
    timestamp: str

    def to_log_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "endpoint": self.endpoint,
            "path": self.path,
            "status_code": self.status_code,
            "latency_ms": round(self.latency_ms, 2),
            "result_count": self.result_count,
            "ok": self.ok,
            "error": self.error,
        }


ENDPOINTS = [
    EndpointCheck(name="search", path="/v1/search", params={"q": "test", "limit": "1"}),
    EndpointCheck(name="products", path="/v1/products", params={"limit": "1"}),
]


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return float(values[0])
    ordered = sorted(float(v) for v in values)
    rank = (len(ordered) - 1) * pct
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[lower]
    lower_value = ordered[lower]
    upper_value = ordered[upper]
    return lower_value + (upper_value - lower_value) * (rank - lower)


def extract_result_count(payload: Any) -> int | None:
    if isinstance(payload, dict):
        for key in ("total_count", "total", "count"):
            value = payload.get(key)
            if isinstance(value, bool):
                continue
            if isinstance(value, (int, float)):
                return int(value)
        for key in ("items", "results", "data", "products"):
            value = payload.get(key)
            if isinstance(value, list):
                return len(value)
        if "result_count" in payload and isinstance(payload["result_count"], (int, float)):
            return int(payload["result_count"])
    elif isinstance(payload, list):
        return len(payload)
    return None


def load_state(state_path: Path) -> dict[str, Any]:
    if not state_path.exists():
        return {"days": {}, "last_alerts": {}}
    try:
        state = json.loads(state_path.read_text())
    except (OSError, json.JSONDecodeError):
        return {"days": {}, "last_alerts": {}}
    state.setdefault("days", {})
    state.setdefault("last_alerts", {})
    return state


def save_state(state_path: Path, state: dict[str, Any]) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, indent=2, sort_keys=True))


def trim_old_days(state: dict[str, Any], keep_days: int = 3) -> None:
    known_days = sorted(state.get("days", {}).keys(), reverse=True)
    for stale_day in known_days[keep_days:]:
        state["days"].pop(stale_day, None)


def ensure_day_bucket(state: dict[str, Any], day_key: str) -> dict[str, Any]:
    days = state.setdefault("days", {})
    day_bucket = days.setdefault(day_key, {"endpoints": {}, "summary_emitted_at": None})
    endpoints = day_bucket.setdefault("endpoints", {})
    for endpoint in ENDPOINTS:
        endpoints.setdefault(
            endpoint.name,
            {
                "checks": 0,
                "successes": 0,
                "latencies_ms": [],
                "last_status_code": None,
                "last_result_count": None,
                "last_error": None,
                "last_checked_at": None,
            },
        )
    return day_bucket


def append_result_to_state(state: dict[str, Any], result: CheckResult, day_key: str) -> None:
    day_bucket = ensure_day_bucket(state, day_key)
    endpoint_bucket = day_bucket["endpoints"][result.endpoint]
    endpoint_bucket["checks"] += 1
    if result.ok:
        endpoint_bucket["successes"] += 1
    endpoint_bucket["latencies_ms"].append(round(result.latency_ms, 2))
    endpoint_bucket["last_status_code"] = result.status_code
    endpoint_bucket["last_result_count"] = result.result_count
    endpoint_bucket["last_error"] = result.error
    endpoint_bucket["last_checked_at"] = result.timestamp


def format_check_line(result: CheckResult) -> str:
    return (
        "CHECK "
        f"timestamp={result.timestamp} "
        f"endpoint={result.endpoint} "
        f"path={result.path} "
        f"status={result.status_code if result.status_code is not None else 'error'} "
        f"latency_ms={result.latency_ms:.2f} "
        f"result_count={result.result_count if result.result_count is not None else 'unknown'} "
        f"ok={'true' if result.ok else 'false'}"
        + (f" error={json.dumps(result.error)}" if result.error else "")
    )


def format_summary_line(day_key: str, state: dict[str, Any]) -> str:
    day_bucket = ensure_day_bucket(state, day_key)
    fragments: list[str] = []
    total_checks = 0
    total_successes = 0
    all_latencies: list[float] = []
    for endpoint in ENDPOINTS:
        stats = day_bucket["endpoints"][endpoint.name]
        checks = stats["checks"]
        successes = stats["successes"]
        latencies = [float(v) for v in stats["latencies_ms"]]
        total_checks += checks
        total_successes += successes
        all_latencies.extend(latencies)
        uptime_pct = (successes / checks * 100.0) if checks else 100.0
        avg_latency = (sum(latencies) / len(latencies)) if latencies else 0.0
        fragments.append(
            f"{endpoint.name}_uptime_pct={uptime_pct:.2f} {endpoint.name}_avg_latency_ms={avg_latency:.2f}"
        )
    overall_uptime_pct = (total_successes / total_checks * 100.0) if total_checks else 100.0
    overall_avg_latency = (sum(all_latencies) / len(all_latencies)) if all_latencies else 0.0
    return (
        "SUMMARY "
        f"date={day_key} "
        f"uptime_pct={overall_uptime_pct:.2f} "
        f"avg_latency_ms={overall_avg_latency:.2f} "
        f"checks={total_checks} "
        + " ".join(fragments)
    )


def build_warnings(
    state: dict[str, Any],
    day_key: str,
    results: list[CheckResult],
    p99_warn_ms: float,
) -> list[dict[str, str]]:
    warnings: list[dict[str, str]] = []
    day_bucket = ensure_day_bucket(state, day_key)

    for result in results:
        if result.status_code is not None and result.status_code >= 500:
            warnings.append(
                {
                    "key": f"{result.endpoint}:5xx",
                    "message": (
                        f"WARN endpoint={result.endpoint} reason=server_error "
                        f"status={result.status_code} latency_ms={result.latency_ms:.2f}"
                    ),
                }
            )
        elif not result.ok:
            warnings.append(
                {
                    "key": f"{result.endpoint}:request_failure",
                    "message": (
                        f"WARN endpoint={result.endpoint} reason=request_failure "
                        f"error={json.dumps(result.error or 'unknown')}"
                    ),
                }
            )

    for endpoint in ENDPOINTS:
        stats = day_bucket["endpoints"][endpoint.name]
        latencies = [float(v) for v in stats["latencies_ms"]]
        if not latencies:
            continue
        p99_latency = percentile(latencies, 0.99)
        if p99_latency > p99_warn_ms:
            warnings.append(
                {
                    "key": f"{endpoint.name}:p99",
                    "message": (
                        f"WARN endpoint={endpoint.name} reason=p99_latency "
                        f"p99_ms={p99_latency:.2f} threshold_ms={p99_warn_ms:.2f}"
                    ),
                }
            )

    return warnings


def should_send_alert(state: dict[str, Any], alert_key: str, now_ts: float, cooldown_seconds: int) -> bool:
    last_alerts = state.setdefault("last_alerts", {})
    last_sent = last_alerts.get(alert_key)
    if not isinstance(last_sent, (int, float)):
        last_alerts[alert_key] = now_ts
        return True
    if now_ts - float(last_sent) >= cooldown_seconds:
        last_alerts[alert_key] = now_ts
        return True
    return False


def send_webhook_alert(webhook_url: str, message: str, timeout_seconds: float) -> None:
    payload = {
        "text": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    try:
        response = httpx.post(webhook_url, json=payload, timeout=timeout_seconds)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        print(f"WARN endpoint=alerting reason=webhook_failed error={json.dumps(str(exc))}")


def run_check(
    client: httpx.Client,
    base_url: str,
    api_key: str,
    timeout_seconds: float,
    endpoint: EndpointCheck,
) -> CheckResult:
    timestamp = datetime.now(timezone.utc).isoformat()
    started_at = time.perf_counter()
    try:
        response = client.get(
            f"{base_url.rstrip('/')}{endpoint.path}",
            params=endpoint.params,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
            },
            timeout=timeout_seconds,
        )
        latency_ms = (time.perf_counter() - started_at) * 1000.0
        try:
            payload = response.json()
        except json.JSONDecodeError:
            payload = None
        result_count = extract_result_count(payload)
        ok = response.status_code < 500
        error = None if ok else f"HTTP {response.status_code}"
        return CheckResult(
            endpoint=endpoint.name,
            path=endpoint.path,
            status_code=response.status_code,
            latency_ms=latency_ms,
            result_count=result_count,
            ok=ok,
            error=error,
            timestamp=timestamp,
        )
    except httpx.TimeoutException:
        latency_ms = (time.perf_counter() - started_at) * 1000.0
        return CheckResult(
            endpoint=endpoint.name,
            path=endpoint.path,
            status_code=None,
            latency_ms=latency_ms,
            result_count=None,
            ok=False,
            error=f"timeout>{timeout_seconds:.0f}s",
            timestamp=timestamp,
        )
    except httpx.HTTPError as exc:
        latency_ms = (time.perf_counter() - started_at) * 1000.0
        return CheckResult(
            endpoint=endpoint.name,
            path=endpoint.path,
            status_code=None,
            latency_ms=latency_ms,
            result_count=None,
            ok=False,
            error=str(exc),
            timestamp=timestamp,
        )


def write_jsonl(log_path: Path, payload: dict[str, Any]) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Monitor BuyWhere API search and products availability.")
    parser.add_argument("--once", action="store_true", help="Run one monitoring cycle.")
    parser.add_argument("--base-url", default=os.environ.get("BUYWHERE_API_URL", DEFAULT_BASE_URL))
    parser.add_argument("--api-key", default=os.environ.get("BUYWHERE_API_KEY"))
    parser.add_argument("--data-dir", type=Path, default=Path(os.environ.get("BUYWHERE_HEALTHCHECK_DIR", DEFAULT_DATA_DIR)))
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=float(os.environ.get("HEALTHCHECK_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS)),
    )
    parser.add_argument(
        "--p99-warn-ms",
        type=float,
        default=float(os.environ.get("TARGET_P99_MS", DEFAULT_P99_WARN_MS)),
    )
    parser.add_argument(
        "--alert-webhook-url",
        default=os.environ.get("ALERT_WEBHOOK_URL", ""),
        help="Optional webhook URL used when WARN conditions fire.",
    )
    parser.add_argument(
        "--alert-cooldown-seconds",
        type=int,
        default=int(os.environ.get("HEALTHCHECK_ALERT_COOLDOWN_SECONDS", DEFAULT_ALERT_COOLDOWN_SECONDS)),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.once:
        print("--once is required", file=sys.stderr)
        return 2
    if not args.api_key:
        print("BUYWHERE_API_KEY is required", file=sys.stderr)
        return 2

    args.data_dir.mkdir(parents=True, exist_ok=True)
    day_key = datetime.now(timezone.utc).date().isoformat()
    state_path = args.data_dir / "state.json"
    jsonl_path = args.data_dir / f"healthcheck-{day_key}.jsonl"

    state = load_state(state_path)
    trim_old_days(state)

    with httpx.Client() as client:
        results = [
            run_check(
                client=client,
                base_url=args.base_url,
                api_key=args.api_key,
                timeout_seconds=args.timeout_seconds,
                endpoint=endpoint,
            )
            for endpoint in ENDPOINTS
        ]

    for result in results:
        append_result_to_state(state, result, day_key)
        write_jsonl(jsonl_path, result.to_log_dict())
        print(format_check_line(result))

    summary_line = format_summary_line(day_key, state)
    print(summary_line)
    write_jsonl(jsonl_path, {"timestamp": datetime.now(timezone.utc).isoformat(), "summary": summary_line})

    warnings = build_warnings(state, day_key, results, args.p99_warn_ms)
    now_ts = time.time()
    for warning in warnings:
        print(warning["message"])
        if args.alert_webhook_url and should_send_alert(
            state,
            warning["key"],
            now_ts=now_ts,
            cooldown_seconds=args.alert_cooldown_seconds,
        ):
            send_webhook_alert(args.alert_webhook_url, warning["message"], args.timeout_seconds)

    save_state(state_path, state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
