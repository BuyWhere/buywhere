#!/usr/bin/env python3
"""
Product Data Pipeline Orchestrator

Orchestrates the full data pipeline:
  1. Scrape   — Run scrapers to fetch product data
  2. Normalize — Convert to canonical schema
  3. Dedup    — Merge duplicate products
  4. Validate — Quality checks
  5. Ingest   — Load into database

Each step tracks status, supports retry on failure, and outputs a pipeline_report.md.

Usage:
    python pipeline.py [--scrape] [--no-scrape] [--dry-run]
    python pipeline.py --scrape --dry-run
"""

import argparse
import asyncio
import json
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import get_settings

settings = get_settings()

SCRIPTS_DIR = Path(__file__).parent
DATA_DIR = Path("/home/paperclip/buywhere-api/data")
NORMALIZED_DIR = DATA_DIR / "normalized"
REPORT_PATH = SCRIPTS_DIR.parent / "pipeline_report.md"

MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 5


@dataclass
class StepResult:
    name: str
    status: str
    duration_seconds: float
    records_in: int = 0
    records_out: int = 0
    errors: int = 0
    message: str = ""
    retry_count: int = 0


@dataclass
class PipelineReport:
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None
    overall_status: str = "running"
    steps: list[StepResult] = field(default_factory=list)
    total_records_scraped: int = 0
    total_records_normalized: int = 0
    total_records_ingested: int = 0
    error: Optional[str] = None


def run_step(name: str, cmd: list[str], env: Optional[dict] = None, cwd: Optional[Path] = None) -> tuple[int, str, str]:
    merged_env = None
    if env:
        import os
        merged_env = {**os.environ, **env}
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=merged_env,
            cwd=cwd or SCRIPTS_DIR,
            timeout=3600,
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return -1, "", f"Command timed out after 3600s: {' '.join(cmd)}"
    except Exception as e:
        return -1, "", str(e)


def run_step_with_retry(name: str, cmd: list[str], env: Optional[dict] = None, cwd: Optional[Path] = None) -> StepResult:
    result = StepResult(name=name, status="pending", duration_seconds=0.0)
    for attempt in range(1, MAX_RETRIES + 1):
        result.retry_count = attempt - 1
        start = time.time()
        returncode, stdout, stderr = run_step(name, cmd, env, cwd)
        result.duration_seconds = time.time() - start

        if returncode == 0:
            result.status = "success"
            result.message = stdout.strip() if stdout else "Completed successfully"
            return result

        result.errors += 1
        result.message = stderr.strip() if stderr else f"Exit code {returncode}"

        if attempt < MAX_RETRIES:
            time.sleep(RETRY_DELAY_SECONDS * attempt)

    result.status = "failed"
    return result


def step1_scrape(dry_run: bool) -> StepResult:
    if dry_run:
        return StepResult(
            name="scrape",
            status="skipped",
            duration_seconds=0.0,
            message="Dry run - scrapers skipped",
        )

    result = run_step_with_retry(
        "scrape",
        [sys.executable, "-m", "scripts.scraper_scheduler", "--once"],
        cwd=SCRIPTS_DIR.parent,
    )

    if result.status == "success":
        scraped_files = list(DATA_DIR.glob("*_sg_*.ndjson"))
        result.records_in = len(scraped_files)
        result.records_out = sum(1 for f in scraped_files if f.stat().st_size > 0)

    return result


def step2_normalize(dry_run: bool) -> StepResult:
    if dry_run:
        return StepResult(
            name="normalize",
            status="skipped",
            duration_seconds=0.0,
            message="Dry run - normalization skipped",
        )

    NORMALIZED_DIR.mkdir(parents=True, exist_ok=True)

    result = run_step_with_retry(
        "normalize",
        [sys.executable, "normalize_catalog.py"],
        cwd=SCRIPTS_DIR,
    )

    if result.status == "success":
        normalized_files = list(NORMALIZED_DIR.glob("*_normalized.ndjson"))
        total_records = 0
        for f in normalized_files:
            with open(f) as fh:
                total_records += sum(1 for _ in fh)
        result.records_out = total_records

    return result


def step3_dedup(dry_run: bool) -> StepResult:
    if dry_run:
        return StepResult(
            name="dedup",
            status="skipped",
            duration_seconds=0.0,
            message="Dry run - dedup skipped",
        )

    result = run_step_with_retry(
        "dedup",
        [sys.executable, "merge_duplicates.py", "--dry-run"],
        cwd=SCRIPTS_DIR,
    )

    if result.status == "success":
        import re
        m = re.search(r"Merge groups found:\s*(\d+)", result.message)
        result.records_out = int(m.group(1)) if m else 0

    return result


def step4_validate(dry_run: bool) -> StepResult:
    if dry_run:
        return StepResult(
            name="validate",
            status="skipped",
            duration_seconds=0.0,
            message="Dry run - validation skipped",
        )

    result = run_step_with_retry(
        "validate",
        [sys.executable, "validate_products.py", "--dry-run"],
        cwd=SCRIPTS_DIR,
    )

    if result.status == "success":
        import re
        m = re.search(r"Total validated:\s*(\d+)", result.message)
        result.records_out = int(m.group(1)) if m else 0

    return result


def step5_ingest(dry_run: bool) -> StepResult:
    if dry_run:
        return StepResult(
            name="ingest",
            status="skipped",
            duration_seconds=0.0,
            message="Dry run - ingestion skipped",
        )

    result = run_step_with_retry(
        "ingest",
        [sys.executable, "ingest_catalog.py"],
        cwd=SCRIPTS_DIR,
    )

    if result.status == "success":
        import re
        m = re.search(r"Total loaded:\s*([\d,]+)", result.message)
        result.records_out = int(m.group(1).replace(",", "")) if m else 0

    return result


def generate_report(report: PipelineReport) -> str:
    lines = []
    lines.append("# Product Data Pipeline Report")
    lines.append("")
    lines.append(f"**Generated:** {datetime.now(timezone.utc).isoformat()}")
    lines.append(f"**Started:** {report.started_at.isoformat()}")
    lines.append(f"**Completed:** {report.completed_at.isoformat() if report.completed_at else 'N/A'}")
    lines.append(f"**Overall Status:** `{report.overall_status}`")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Step Summary")
    lines.append("")
    lines.append("| Step | Status | Duration | Records In | Records Out | Errors | Retries |")
    lines.append("|------|--------|----------|------------|-------------|--------|---------|")

    for step in report.steps:
        lines.append(
            f"| {step.name} | `{step.status}` | {step.duration_seconds:.1f}s | "
            f"{step.records_in:,} | {step.records_out:,} | {step.errors} | {step.retry_count} |"
        )

    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Step Details")
    lines.append("")

    for step in report.steps:
        lines.append(f"### {step.name}")
        lines.append(f"- **Status:** `{step.status}`")
        lines.append(f"- **Duration:** {step.duration_seconds:.1f}s")
        lines.append(f"- **Records in:** {step.records_in:,}")
        lines.append(f"- **Records out:** {step.records_out:,}")
        lines.append(f"- **Errors:** {step.errors}")
        lines.append(f"- **Retries:** {step.retry_count}")
        if step.message:
            msg_preview = step.message[:200].replace("\n", " ")
            lines.append(f"- **Message:** {msg_preview}")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## Recommendations")
    lines.append("")

    failed_steps = [s for s in report.steps if s.status == "failed"]
    if failed_steps:
        lines.append("### Issues Detected")
        for s in failed_steps:
            lines.append(f"- **{s.name}** failed: {s.message[:100]}")
        lines.append("")
    else:
        lines.append("All steps completed successfully.")
        lines.append("")

    if report.total_records_ingested > 0:
        lines.append(f"**Total records ingested this run:** {report.total_records_ingested:,}")
    elif report.total_records_normalized > 0:
        lines.append(f"**Total records normalized:** {report.total_records_normalized:,}")

    return "\n".join(lines)


def run_pipeline(scrape: bool, dry_run: bool) -> PipelineReport:
    report = PipelineReport()

    steps_config = [
        ("scrape", lambda: step1_scrape(dry_run or not scrape)),
        ("normalize", lambda: step2_normalize(dry_run)),
        ("dedup", lambda: step3_dedup(dry_run)),
        ("validate", lambda: step4_validate(dry_run)),
        ("ingest", lambda: step5_ingest(dry_run)),
    ]

    print("=" * 60)
    print("Product Data Pipeline Orchestrator")
    print("=" * 60)
    print(f"Scrape:    {'enabled' if scrape else 'disabled'}")
    print(f"Dry run:   {'yes' if dry_run else 'no'}")
    print(f"Max retries: {MAX_RETRIES}")
    print("=" * 60)

    for step_name, step_fn in steps_config:
        if step_name == "scrape" and not scrape:
            step = StepResult(
                name="scrape",
                status="skipped",
                duration_seconds=0.0,
                message="Scrape step disabled via --no-scrape",
            )
        else:
            print(f"\n[{step_name.upper()}] Starting...")
            step = step_fn()
            print(f"[{step_name.upper()}] {step.status} ({step.duration_seconds:.1f}s)")

        report.steps.append(step)

        if step.records_out > 0:
            if step_name == "normalize":
                report.total_records_normalized = step.records_out
            elif step_name == "ingest":
                report.total_records_ingested = step.records_out

        if step.status == "failed":
            report.overall_status = "failed"
            report.error = f"Step '{step_name}' failed: {step.message}"
            print(f"\nERROR: {step_name} failed after {step.retry_count} retries")
            print(f"  Message: {step.message[:200]}")
            break

    report.completed_at = datetime.now(timezone.utc)
    report.overall_status = "success" if all(s.status in ("success", "skipped") for s in report.steps) else "failed"

    return report


def main():
    parser = argparse.ArgumentParser(description="Product Data Pipeline Orchestrator")
    parser.add_argument("--scrape", action="store_true", help="Run scrapers before pipeline")
    parser.add_argument("--no-scrape", action="store_true", help="Skip scrape step (use existing data)")
    parser.add_argument("--dry-run", action="store_true", help="Validate without writing to DB")
    args = parser.parse_args()

    scrape_enabled = args.scrape and not args.no_scrape

    report = run_pipeline(scrape=scrape_enabled, dry_run=args.dry_run)

    report_md = generate_report(report)

    with open(REPORT_PATH, "w") as f:
        f.write(report_md)
    print(f"\nReport written to: {REPORT_PATH}")

    print("\n" + "=" * 60)
    print("PIPELINE SUMMARY")
    print("=" * 60)
    for step in report.steps:
        print(f"  {step.name:<12} {step.status:<10} {step.duration_seconds:>6.1f}s  in={step.records_in:,}  out={step.records_out:,}")
    print(f"\nOverall: {report.overall_status}")
    print("=" * 60)

    if report.overall_status == "failed":
        sys.exit(1)


if __name__ == "__main__":
    main()
