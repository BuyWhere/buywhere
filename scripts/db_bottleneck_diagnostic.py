#!/usr/bin/env python3
"""
Database bottleneck diagnostic script for BUY-4999 / BUY-3009.
Run against Cloud SQL staging instance via Cloud Run job or direct connection.

Usage:
  python scripts/db_bottleneck_diagnostic.py --env staging

Requires:
  - pg_stat_statements extension enabled on Cloud SQL
  - DATABASE_URL environment variable pointing to the target database
"""

import argparse
import os
import sys
from typing import Optional

try:
    import asyncpg
except ImportError:
    print("ERROR: asyncpg not installed. Run: pip install asyncpg")
    sys.exit(1)


async def run_diagnostics(env: str) -> dict:
    """Run all diagnostic queries and return combined results."""
    
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable not set")
        sys.exit(1)
    
    conn = await asyncpg.connect(database_url)
    
    results = {
        "env": env,
        "pg_stat_statements_available": False,
        "top_slow_queries": [],
        "index_usage": [],
        "table_stats": {},
        "cache_hit_ratio": {},
        "connection_stats": {},
    }
    
    try:
        extension_check = await conn.fetchval(
            "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'"
        )
        results["pg_stat_statements_available"] = extension_check == 1
    except Exception as e:
        print(f"pg_stat_statements check failed: {e}")
    
    if results["pg_stat_statements_available"]:
        results["top_slow_queries"] = await get_top_slow_queries(conn)
    
    results["index_usage"] = await get_index_usage(conn)
    results["table_stats"] = await get_table_stats(conn)
    results["connection_stats"] = await get_connection_stats(conn)
    
    await conn.close()
    return results


async def get_top_slow_queries(conn) -> list:
    """Get top 10 slowest queries by total execution time."""
    try:
        rows = await conn.fetch("""
            SELECT 
                query,
                calls,
                total_exec_time::float / 1000 as total_sec,
                mean_exec_time::float / 1000 as mean_ms,
                max_exec_time::float / 1000 as max_ms,
                stddev_exec_time::float / 1000 as stddev_ms,
                rows::bigint as total_rows
            FROM pg_stat_statements
            WHERE query NOT LIKE '%pg_stat_statements%'
            ORDER BY total_exec_time DESC
            LIMIT 10
        """)
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"Failed to get slow queries: {e}")
        return []


async def get_index_usage(conn) -> list:
    """Get index usage statistics."""
    try:
        rows = await conn.fetch("""
            SELECT 
                schemaname,
                tablename,
                indexname,
                idx_scan::bigint as scans,
                idx_tup_read::bigint as tuples_read,
                idx_tup_fetch::bigint as tuples_fetched,
                pg_size_pretty(pg_relation_size(indexrelid)) as index_size
            FROM pg_stat_user_indexes
            WHERE idx_scan > 0
            ORDER BY idx_scan DESC
            LIMIT 20
        """)
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"Failed to get index usage: {e}")
        return []


async def get_table_stats(conn) -> dict:
    """Get table statistics including row counts and cache hit rates."""
    try:
        rows = await conn.fetch("""
            SELECT 
                schemaname,
                relname as table_name,
                n_live_tup::bigint as row_count_estimate,
                n_dead_tup::bigint as dead_rows,
                last_vacuum,
                last_autovacuum,
                last_analyze,
                n_mod_since_analyze::bigint as rows_modified_since_analyze
            FROM pg_stat_user_tables
            WHERE schemaname = 'public'
            ORDER BY n_live_tup DESC
            LIMIT 20
        """)
        return {"tables": [dict(r) for r in rows]}
    except Exception as e:
        print(f"Failed to get table stats: {e}")
        return {}


async def get_connection_stats(conn) -> dict:
    """Get current connection stats."""
    try:
        rows = await conn.fetch("""
            SELECT 
                state,
                COUNT(*) as count,
                MAX(EXTRACT(EPOCH FROM (now() - state_change_time))) as max_duration_sec
            FROM pg_stat_activity
            WHERE datname = current_database()
            GROUP BY state
        """)
        return {"connection_states": [dict(r) for r in rows]}
    except Exception as e:
        print(f"Failed to get connection stats: {e}")
        return {}


def format_diagnostic_report(results: dict) -> str:
    """Format diagnostic results as markdown report."""
    report = ["# Database Bottleneck Diagnostic Report\n"]
    report.append(f"**Environment:** {results['env']}")
    report.append(f"**pg_stat_statements available:** {results['pg_stat_statements_available']}")
    report.append("")
    
    if results["top_slow_queries"]:
        report.append("## Top 10 Slowest Queries (by total execution time)\n")
        for i, q in enumerate(results["top_slow_queries"], 1):
            report.append(f"### {i}. {q['mean_ms']:.2f}ms avg, {q['total_sec']:.2f}s total\n")
            query_text = q["query"][:500] + "..." if len(q["query"]) > 500 else q["query"]
            report.append(f"```sql\n{query_text}\n```")
            report.append(f"- Calls: {q['calls']:,}")
            report.append(f"- Mean: {q['mean_ms']:.2f}ms")
            report.append(f"- Max: {q['max_ms']:.2f}ms")
            report.append(f"- Rows: {q['total_rows']:,}")
            report.append("")
    else:
        report.append("## Top Slow Queries\n")
        report.append("_pg_stat_statements not available. Enable extension to collect query timing data._\n")
    
    if results["index_usage"]:
        report.append("## Index Usage (Top 20 by scan count)\n")
        report.append("| Table | Index | Scans | Tuples Read | Size |")
        report.append("|-------|-------|-------|-------------|------|")
        for idx in results["index_usage"]:
            report.append(f"| {idx['tablename']} | {idx['indexname']} | {idx['scans']:,} | {idx['tuples_read']:,} | {idx['index_size']} |")
        report.append("")
    
    if results["table_stats"].get("tables"):
        report.append("## Table Statistics\n")
        report.append("| Table | Rows (est) | Dead Rows | Last Vacuum | Mod Since Analyze |")
        report.append("|-------|------------|-----------|-------------|-------------------|")
        for t in results["table_stats"]["tables"]:
            report.append(f"| {t['table_name']} | {t['row_count_estimate']:,} | {t['dead_rows']:,} | {t['last_vacuum'] or 'never'} | {t['rows_modified_since_analyze']:,} |")
        report.append("")
    
    return "\n".join(report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run database bottleneck diagnostics")
    parser.add_argument("--env", default="staging", help="Environment name for reporting")
    args = parser.parse_args()
    
    import asyncio
    results = asyncio.run(run_diagnostics(args.env))
    report = format_diagnostic_report(results)
    print(report)