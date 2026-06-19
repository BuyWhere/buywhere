#!/usr/bin/env python3
"""
BuyWhere Ingestion Pipeline Health Check
=========================================
Recurring health check for the ingestion pipeline.

Checks:
1. API health endpoint
2. Database connectivity and query performance
3. Redis connectivity
4. Zombie ingestion runs (stuck in 'running' > 1h)
5. Data freshness (products updated recently)
6. Ingestion run success rate (last 24h / 7d)
7. Source-level health

Exit codes:
  0 - healthy
  1 - degraded (warnings but functional)
  2 - unhealthy (critical issues)

Usage:
  python3 scripts/ingestion_pipeline_healthcheck.py [--fix] [--json]
  python3 scripts/ingestion_pipeline_healthcheck.py --cron          # write JSON report to data/reports/
  python3 scripts/ingestion_pipeline_healthcheck.py --exit-code     # exit with health code
  python3 scripts/ingestion_pipeline_healthcheck.py --json          # stdout JSON only
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta

import psycopg2
import redis as redis_lib

try:
    import urllib.request
    import urllib.error

    HTTP_AVAILABLE = True
except ImportError:
    HTTP_AVAILABLE = False


class HealthCheck:
    def __init__(self, fix_mode=False):
        self.fix_mode = fix_mode
        self.results = []
        self.critical = []
        self.warnings = []
        self.api_base = os.environ.get("API_BASE_URL", "https://api.buywhere.ai")
        self.db_url = os.environ.get("DATABASE_URL", "")
        self.redis_url = os.environ.get("REDIS_URL", "")

    def add_result(self, check, status, message, detail=None):
        entry = {
            "check": check,
            "status": status,
            "message": message,
            "detail": detail,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self.results.append(entry)
        if status == "critical":
            self.critical.append(entry)
        elif status == "warning":
            self.warnings.append(entry)
        return entry

    def check_api_health(self):
        check = "api_health"
        if not HTTP_AVAILABLE:
            return self.add_result(check, "warning", "urllib not available, skipping API check")

        url = f"{self.api_base}/health"
        try:
            start = time.time()
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = json.loads(resp.read().decode())
                latency_ms = round((time.time() - start) * 1000, 1)
                if body.get("status") == "ok":
                    return self.add_result(
                        check, "ok", f"API healthy (latency: {latency_ms}ms)", body
                    )
                else:
                    return self.add_result(
                        check, "critical", f"API returned non-ok status: {body}", body
                    )
        except Exception as e:
            return self.add_result(check, "critical", f"API unreachable: {e}")

    def check_database(self):
        check = "database"
        if not self.db_url:
            return self.add_result(check, "critical", "DATABASE_URL not set")

        try:
            start = time.time()
            conn = psycopg2.connect(self.db_url)
            cur = conn.cursor()

            cur.execute("SELECT 1;")
            latency_ms = round((time.time() - start) * 1000, 1)

            cur.execute("SELECT COUNT(*) FROM products;")
            total_products = cur.fetchone()[0]

            cur.execute(
                "SELECT COUNT(*) FROM ingestion_runs WHERE status = 'running';"
            )
            running_runs = cur.fetchone()[0]

            cur.execute(
                """
                SELECT COUNT(*) FROM ingestion_runs
                WHERE status = 'running' AND started_at < NOW() - INTERVAL '1 hour';
            """
            )
            zombie_runs = cur.fetchone()[0]

            cur.execute(
                """
                SELECT COUNT(*) FROM products
                WHERE is_active = true AND updated_at < NOW() - INTERVAL '7 days';
            """
            )
            stale_products = cur.fetchone()[0]

            cur.execute(
                """
                SELECT source, COUNT(*) as cnt, MAX(started_at) as last_started
                FROM ingestion_runs
                WHERE status = 'running' AND started_at < NOW() - INTERVAL '1 hour'
                GROUP BY source
                ORDER BY cnt DESC
                LIMIT 5;
            """
            )
            zombie_sources = [
                {"source": r[0], "count": r[1], "last_started": str(r[2])}
                for r in cur.fetchall()
            ]

            cur.execute(
                """
                SELECT
                    COUNT(*) FILTER (WHERE status IN ('completed','completed_with_issues')) as success,
                    COUNT(*) FILTER (WHERE status = 'failed') as failed,
                    COUNT(*) as total
                FROM ingestion_runs
                WHERE started_at > NOW() - INTERVAL '24 hours';
            """
            )
            row = cur.fetchone()
            runs_24h = {"success": row[0], "failed": row[1], "total": row[2]}

            cur.execute(
                """
                SELECT source, COUNT(*) as cnt, MAX(updated_at) as last_updated
                FROM products
                WHERE updated_at > NOW() - INTERVAL '24 hours'
                GROUP BY source
                ORDER BY cnt DESC
                LIMIT 10;
            """
            )
            fresh_sources = [
                {"source": r[0], "count": r[1], "last_updated": str(r[2])}
                for r in cur.fetchall()
            ]

            conn.close()

            detail = {
                "latency_ms": latency_ms,
                "total_products": total_products,
                "zombie_runs": zombie_runs,
                "running_runs": running_runs,
                "stale_active_products": stale_products,
                "runs_last_24h": runs_24h,
                "zombie_sources": zombie_sources,
                "fresh_sources": fresh_sources,
            }

            if zombie_runs > 0:
                if self.fix_mode:
                    self._fix_zombie_runs()
                    return self.add_result(
                        check,
                        "warning",
                        f"DB OK ({latency_ms}ms). Fixed {zombie_runs} zombie runs.",
                        detail,
                    )
                return self.add_result(
                    check,
                    "warning",
                    f"DB OK ({latency_ms}ms). {zombie_runs} zombie runs detected.",
                    detail,
                )

            return self.add_result(
                check, "ok", f"DB healthy ({latency_ms}ms, {total_products} products)", detail
            )

        except Exception as e:
            return self.add_result(check, "critical", f"DB connection failed: {e}")

    def _fix_zombie_runs(self):
        try:
            conn = psycopg2.connect(self.db_url)
            cur = conn.cursor()
            cur.execute(
                """
                UPDATE ingestion_runs
                SET status = 'failed',
                    error_message = 'Auto-cleaned: run stuck in running status for >1h (health check cleanup)',
                    finished_at = started_at + INTERVAL '1 hour'
                WHERE status = 'running' AND started_at < NOW() - INTERVAL '1 hour'
                RETURNING id;
            """
            )
            count = len(cur.fetchall())
            conn.commit()
            conn.close()
            return count
        except Exception:
            return 0

    def check_redis(self):
        check = "redis"
        if not self.redis_url:
            return self.add_result(check, "warning", "REDIS_URL not set, skipping")

        try:
            start = time.time()
            r = redis_lib.from_url(self.redis_url)
            r.ping()
            latency_ms = round((time.time() - start) * 1000, 1)

            ingestion_keys = r.keys("bw:ingestion:*")
            info = r.info("memory")

            detail = {
                "latency_ms": latency_ms,
                "ingestion_keys": len(ingestion_keys),
                "used_memory_human": info.get("used_memory_human", "unknown"),
            }

            return self.add_result(check, "ok", f"Redis healthy ({latency_ms}ms)", detail)
        except Exception as e:
            return self.add_result(check, "critical", f"Redis connection failed: {e}")

    def check_ingestion_success_rate(self):
        check = "ingestion_success_rate"
        if not self.db_url:
            return self.add_result(check, "skipped", "No database connection")

        try:
            conn = psycopg2.connect(self.db_url)
            cur = conn.cursor()

            cur.execute(
                """
                SELECT
                    COUNT(*) FILTER (WHERE status IN ('completed','completed_with_issues')) as success,
                    COUNT(*) FILTER (WHERE status = 'failed') as failed,
                    COUNT(*) as total
                FROM ingestion_runs
                WHERE started_at > NOW() - INTERVAL '7 days';
            """
            )
            row = cur.fetchone()
            conn.close()

            total = row[2]
            success = row[0]
            failed = row[1]

            if total == 0:
                return self.add_result(
                    check, "warning", "No ingestion runs in the past 7 days"
                )

            success_rate = round(success / total * 100, 1)
            detail = {
                "total": total,
                "success": success,
                "failed": failed,
                "success_rate_pct": success_rate,
            }

            if success_rate < 50:
                return self.add_result(
                    check,
                    "critical",
                    f"Low success rate: {success_rate}% (7d)",
                    detail,
                )
            elif success_rate < 80:
                return self.add_result(
                    check,
                    "warning",
                    f"Degraded success rate: {success_rate}% (7d)",
                    detail,
                )

            return self.add_result(
                check, "ok", f"Success rate: {success_rate}% (7d, {total} runs)", detail
            )
        except Exception as e:
            return self.add_result(check, "critical", f"Could not check success rate: {e}")

    def run(self):
        self.check_api_health()
        self.check_database()
        self.check_redis()
        self.check_ingestion_success_rate()
        return self.summary()

    def summary(self):
        if self.critical:
            overall = "unhealthy"
            exit_code = 2
        elif self.warnings:
            overall = "degraded"
            exit_code = 1
        else:
            overall = "healthy"
            exit_code = 0

        return {
            "overall": overall,
            "exit_code": exit_code,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "checks": len(self.results),
            "ok": len([r for r in self.results if r["status"] == "ok"]),
            "warnings": len(self.warnings),
            "critical": len(self.critical),
            "results": self.results,
        }


def main():
    parser = argparse.ArgumentParser(description="BuyWhere Ingestion Pipeline Health Check")
    parser.add_argument("--fix", action="store_true", help="Auto-fix zombie runs")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument(
        "--cron", action="store_true",
        help="Cron mode: write JSON report to data/reports/ and print one-line summary"
    )
    parser.add_argument(
        "--report-dir", default=None,
        help="Directory for cron report files (default: data/reports/ under repo root)"
    )
    parser.add_argument(
        "--exit-code", action="store_true", help="Exit with health status code"
    )
    args = parser.parse_args()

    # Resolve report-dir for --cron mode
    if args.cron:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        repo_root = os.path.abspath(os.path.join(script_dir, ".."))
        args.report_dir = args.report_dir or os.path.join(repo_root, "data", "reports")
        args.json = True  # force JSON for report file
        args.exit_code = True  # propagate exit code for crontab
        args.fix = True  # auto-fix zombie runs on each cron tick

    hc = HealthCheck(fix_mode=args.fix)
    report = hc.run()

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"\n{'='*60}")
        print(f"BuyWhere Ingestion Pipeline Health Check")
        print(f"{'='*60}")
        print(f"Overall: {report['overall'].upper()}")
        print(f"Time:    {report['timestamp']}")
        print(f"Checks:  {report['ok']} ok, {report['warnings']} warnings, {report['critical']} critical")
        print(f"{'='*60}")
        for r in report["results"]:
            icon = {"ok": "+", "warning": "!", "critical": "X", "skipped": "-"}.get(
                r["status"], "?"
            )
            print(f"  [{icon}] {r['check']}: {r['message']}")
            if r.get("detail") and not args.json:
                d = r["detail"]
                if isinstance(d, dict):
                    for k, v in d.items():
                        if k in ("zombie_sources", "fresh_sources"):
                            print(f"      {k}:")
                            for item in v[:3]:
                                print(f"        - {item}")
                        elif k != "runs_last_24h":
                            print(f"      {k}: {v}")
        print(f"{'='*60}\n")
    if args.cron:
        os.makedirs(args.report_dir, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        report_file = os.path.join(args.report_dir, f"ingestion-healthcheck-{ts}.json")

        with open(report_file, "w") as f:
            json.dump(report, f, indent=2)

        summary_line = (
            f"[BUY-53336] ingestion-healthcheck overall={report['overall']} "
            f"ok={report['ok']} warn={report['warnings']} crit={report['critical']} "
            f"exit={report['exit_code']} report={report_file}"
        )
        print(summary_line)

        # Clean up old reports (>7 days)
        cutoff = time.time() - 7 * 86400
        for fname in os.listdir(args.report_dir):
            fpath = os.path.join(args.report_dir, fname)
            if fname.startswith("ingestion-healthcheck-") and os.path.isfile(fpath):
                if os.path.getmtime(fpath) < cutoff:
                    os.remove(fpath)


    if args.exit_code:
        sys.exit(report["exit_code"])


if __name__ == "__main__":
    main()
