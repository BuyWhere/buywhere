#!/usr/bin/env python3
"""BUY-72555 catalog.products autovacuum liveness guard."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import request
from urllib.parse import urlparse

import psycopg2
import psycopg2.extras


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DSN_FILE = REPO_ROOT / "data" / ".catalog_db_url"
DEFAULT_STATE_FILE = REPO_ROOT / "data" / "buy72555-zombie-vacuum-guard-state.json"
DEFAULT_REPORT_FILE = REPO_ROOT / "data" / "reports" / "buy72555-zombie-vacuum-guard-latest.json"
DEFAULT_TARGET_SCHEMA = "catalog"
FALLBACK_TARGET_SCHEMA = "public"
TARGET_TABLE = "products"
LOCK_NAME = "catalog.vacuum.products"
FORBIDDEN_DSN_HOSTS = {"roundhouse.proxy.rlwy.net"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def read_dsn(path: Path) -> str:
    dsn_candidates = [os.getenv("CATALOG_DATABASE_URL")]
    if path.exists():
        dsn_candidates.append(path.read_text(encoding="utf-8"))
    dsn_candidates.append(os.getenv("DATABASE_URL"))
    for candidate in dsn_candidates:
        if not candidate:
            continue
        dsn = candidate.strip()
        validate_catalog_dsn(dsn)
        return dsn
    raise RuntimeError(f"No catalog DB DSN found in env or {path}")


def validate_catalog_dsn(dsn: str) -> None:
    host = urlparse(dsn).hostname
    if host in FORBIDDEN_DSN_HOSTS:
        raise RuntimeError(f"Refusing control-plane DSN host for catalog guard: {host}")


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if value.__class__.__module__ == "datetime":
        return str(value)
    return value


def resolve_target(cur: psycopg2.extensions.cursor, preferred_schema: str, table: str) -> tuple[str, str]:
    for schema in [preferred_schema, FALLBACK_TARGET_SCHEMA]:
        cur.execute("SELECT to_regclass(%s) AS regclass", (f"{schema}.{table}",))
        if cur.fetchone()["regclass"]:
            return schema, table
    raise RuntimeError(f"Neither {preferred_schema}.{table} nor {FALLBACK_TARGET_SCHEMA}.{table} exists")


def fetch_stats(dsn: str, preferred_schema: str, table: str) -> dict[str, Any]:
    with psycopg2.connect(dsn, connect_timeout=10) as conn:
        conn.autocommit = True
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SET statement_timeout = '15s'")
            target_schema, target_table = resolve_target(cur, preferred_schema, table)
            cur.execute(
                """
                SELECT
                  s.schemaname,
                  s.relname,
                  s.n_live_tup,
                  s.n_dead_tup,
                  s.n_mod_since_analyze,
                  s.last_vacuum,
                  s.last_autovacuum,
                  s.vacuum_count,
                  s.autovacuum_count,
                  s.last_analyze,
                  s.last_autoanalyze,
                  s.analyze_count,
                  s.autoanalyze_count,
                  c.reloptions,
                  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
                FROM pg_stat_all_tables s
                JOIN pg_class c ON c.relname = s.relname
                JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = s.schemaname
                WHERE s.schemaname = %s AND s.relname = %s
                """,
                (target_schema, target_table),
            )
            row = cur.fetchone()
            if not row:
                raise RuntimeError(f"{target_schema}.{target_table} not found in pg_stat_all_tables")

            cur.execute(
                """
                SELECT name, setting, unit
                FROM pg_settings
                WHERE name IN (
                  'autovacuum',
                  'autovacuum_naptime',
                  'autovacuum_vacuum_scale_factor',
                  'autovacuum_vacuum_threshold'
                )
                ORDER BY name
                """
            )
            settings = {r["name"]: {"setting": r["setting"], "unit": r["unit"]} for r in cur.fetchall()}

            cur.execute(
                """
                SELECT pid, usename, application_name, state, wait_event_type, wait_event,
                       now() - query_start AS age, left(query, 160) AS query
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND query ~* '\\mVACUUM\\M'
                  AND query ~* '\\mproducts\\M'
                  AND state <> 'idle'
                ORDER BY query_start
                """
            )
            active_vacuums = [dict(r) for r in cur.fetchall()]

            cur.execute("SELECT hashtextextended(%s, 0)::bigint AS lock_id", (LOCK_NAME,))
            lock_id = cur.fetchone()["lock_id"]

    result = dict(row)
    result["requested_target"] = f"{preferred_schema}.{table}"
    result["effective_target"] = f"{target_schema}.{target_table}"
    result["settings"] = settings
    result["active_manual_vacuums"] = active_vacuums
    result["advisory_lock_name"] = LOCK_NAME
    result["advisory_lock_id"] = lock_id
    return json_safe(result)


def reloptions_map(reloptions: Any) -> dict[str, str]:
    result: dict[str, str] = {}
    for option in reloptions or []:
        if "=" in option:
            key, value = option.split("=", 1)
            result[key] = value
    return result


def setting_value(stats: dict[str, Any], setting: str) -> str | None:
    table_options = reloptions_map(stats.get("reloptions"))
    return table_options.get(setting) or (stats.get("settings") or {}).get(setting, {}).get("setting")


def evaluate(stats: dict[str, Any], state: dict[str, Any], args: argparse.Namespace) -> tuple[str, list[str]]:
    reasons: list[str] = []
    previous = state.get("last_sample") or {}
    now_ts = time.time()
    previous_ts = float(previous.get("sample_epoch", 0) or 0)
    elapsed_seconds = now_ts - previous_ts if previous_ts else 0
    autovacuum_count = int(stats.get("autovacuum_count") or 0)
    previous_autovacuum_count = int(previous.get("autovacuum_count") or 0)
    delta = autovacuum_count - previous_autovacuum_count if previous else None
    n_mod = int(stats.get("n_mod_since_analyze") or 0)
    settings = stats.get("settings") or {}

    if settings.get("autovacuum", {}).get("setting") != "on":
        reasons.append("cluster autovacuum is not on")

    scale_factor = setting_value(stats, "autovacuum_vacuum_scale_factor")
    threshold = setting_value(stats, "autovacuum_vacuum_threshold")
    try:
        if float(scale_factor) > args.max_scale_factor:
            reasons.append(f"autovacuum_vacuum_scale_factor={scale_factor} exceeds {args.max_scale_factor}")
    except (TypeError, ValueError):
        reasons.append(f"autovacuum_vacuum_scale_factor unreadable: {scale_factor}")
    try:
        if int(float(threshold)) > args.max_threshold:
            reasons.append(f"autovacuum_vacuum_threshold={threshold} exceeds {args.max_threshold}")
    except (TypeError, ValueError):
        reasons.append(f"autovacuum_vacuum_threshold unreadable: {threshold}")

    if stats.get("active_manual_vacuums"):
        reasons.append(f"manual VACUUM active on {stats.get('effective_target')}")

    if previous and n_mod > args.mod_threshold and elapsed_seconds >= args.window_minutes * 60 and delta == 0:
        reasons.append(
            f"n_mod_since_analyze={n_mod} > {args.mod_threshold} with autovacuum_count delta=0 for {elapsed_seconds / 60:.1f} minutes"
        )

    return ("critical" if reasons else "ok", reasons)


def post_paperclip_comment(status: str, report: dict[str, Any]) -> None:
    if status == "ok":
        return
    api_url = os.getenv("PAPERCLIP_API_URL")
    api_key = os.getenv("PAPERCLIP_API_KEY")
    issue_id = os.getenv("PAPERCLIP_TASK_ID", "BUY-72555")
    if not api_url or not api_key or not issue_id:
        return
    base = api_url.rstrip("/")
    if base.endswith("/api"):
        base = base[:-4]
    body = {
        "body": "BUY-72555 zombie-VACUUM guard alert: "
        + "; ".join(report.get("reasons", []))
        + "\nLatest report: data/reports/buy72555-zombie-vacuum-guard-latest.json"
    }
    req = request.Request(
        f"{base}/api/issues/{issue_id}/comments",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-Paperclip-Run-Id": os.getenv("PAPERCLIP_RUN_ID", "buy72555-cron"),
        },
        method="POST",
    )
    try:
        request.urlopen(req, timeout=10).read()
    except Exception:
        return


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Hourly catalog.products autovacuum liveness guard")
    parser.add_argument("--dsn-file", type=Path, default=DEFAULT_DSN_FILE)
    parser.add_argument("--state-file", type=Path, default=DEFAULT_STATE_FILE)
    parser.add_argument("--report-file", type=Path, default=DEFAULT_REPORT_FILE)
    parser.add_argument("--mod-threshold", type=int, default=1_000_000)
    parser.add_argument("--window-minutes", type=int, default=30)
    parser.add_argument("--max-scale-factor", type=float, default=0.05)
    parser.add_argument("--max-threshold", type=int, default=5_000)
    parser.add_argument("--schema", default=os.getenv("BUY72555_PRODUCTS_SCHEMA", DEFAULT_TARGET_SCHEMA))
    parser.add_argument("--table", default=os.getenv("BUY72555_PRODUCTS_TABLE", TARGET_TABLE))
    parser.add_argument("--no-comment", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    sample_epoch = time.time()
    sample_time = utc_now().isoformat()
    dsn = read_dsn(args.dsn_file)
    state = load_state(args.state_file)
    stats = fetch_stats(dsn, args.schema, args.table)
    status, reasons = evaluate(stats, state, args)
    report = {
        "issue": "BUY-72555",
        "sample_time": sample_time,
        "status": status,
        "reasons": reasons,
        "stats": stats,
    }
    write_json(args.report_file, report)
    write_json(
        args.state_file,
        {
            "last_sample": {
                "sample_epoch": sample_epoch,
                "sample_time": sample_time,
                "autovacuum_count": stats.get("autovacuum_count"),
                "n_mod_since_analyze": stats.get("n_mod_since_analyze"),
            }
        },
    )
    if not args.no_comment:
        post_paperclip_comment(status, report)
    print(
        f"BUY-72555 {status}: n_mod_since_analyze={stats.get('n_mod_since_analyze')} "
        f"autovacuum_count={stats.get('autovacuum_count')} reasons={len(reasons)}"
    )
    return 2 if status == "critical" else 0


if __name__ == "__main__":
    sys.exit(main())
