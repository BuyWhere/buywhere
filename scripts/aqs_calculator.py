#!/usr/bin/env python3
"""AQS Calculator runner.

Reads the latest AQS test-cycle JSON, computes the composite Agent Quality
Score, appends the result JSON alongside the cycle data, and logs any
escalation alerts.

Designed to run every 15 minutes (cron / Cloud Scheduler).

Usage:
    python scripts/aqs_calculator.py [--cycle-file PATH] [--output-file PATH]
                                     [--history-file PATH] [--dry-run]

Environment:
    AQS_CYCLE_DIR   Directory where test-cycle JSON files are written
                    (default: /tmp/aqs-cycles)
    AQS_OUTPUT_DIR  Directory where computed AQS outputs are written
                    (default: /tmp/aqs-output)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("aqs-calculator")

# ---------------------------------------------------------------------------
# Add project root to path so app packages resolve
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from app.services.aqs_calculator import compute_aqs, aqs_result_to_dict  # noqa: E402


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_CYCLE_DIR = Path(os.environ.get("AQS_CYCLE_DIR", "/tmp/aqs-cycles"))
DEFAULT_OUTPUT_DIR = Path(os.environ.get("AQS_OUTPUT_DIR", "/tmp/aqs-output"))
DEFAULT_HISTORY_FILE = DEFAULT_OUTPUT_DIR / "aqs_history.jsonl"
HISTORY_WINDOW = 10  # keep last N cycles for escalation look-back


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _latest_cycle_file(cycle_dir: Path) -> Path | None:
    """Return the most recently modified *.json in cycle_dir."""
    files = sorted(cycle_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def _load_history(history_file: Path, window: int = HISTORY_WINDOW) -> list[dict]:
    if not history_file.exists():
        return []
    lines = history_file.read_text().splitlines()
    recent = []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            recent.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(recent) >= window:
            break
    return list(reversed(recent))


def _append_history(history_file: Path, result_dict: dict) -> None:
    history_file.parent.mkdir(parents=True, exist_ok=True)
    with history_file.open("a") as f:
        f.write(json.dumps(result_dict, default=str) + "\n")


def _write_output(output_dir: Path, result_dict: dict, cycle_id: str) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_id = "".join(c if c.isalnum() or c in "-_" else "_" for c in cycle_id)[:40]
    out_path = output_dir / f"aqs_{safe_id}_{ts}.json"
    out_path.write_text(json.dumps(result_dict, indent=2, default=str))
    return out_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(
    cycle_file: Path | None = None,
    output_file: Path | None = None,
    history_file: Path = DEFAULT_HISTORY_FILE,
    cycle_dir: Path = DEFAULT_CYCLE_DIR,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    dry_run: bool = False,
) -> dict:
    """Compute AQS for the latest cycle.  Returns the result dict."""

    # 1. Locate cycle file
    if cycle_file is None:
        cycle_file = _latest_cycle_file(cycle_dir)
        if cycle_file is None:
            log.error("No cycle JSON found in %s", cycle_dir)
            sys.exit(1)
    log.info("Loading cycle from %s", cycle_file)
    cycle = json.loads(cycle_file.read_text())

    # 2. Load prior cycles for multi-cycle escalation rules
    prior_cycles = _load_history(history_file)
    log.info("Loaded %d prior AQS cycles for escalation look-back", len(prior_cycles))

    # 3. Compute
    result = compute_aqs(cycle, prior_cycles=prior_cycles)
    result_dict = aqs_result_to_dict(result)

    log.info(
        "AQS cycle_id=%s  score=%.2f  grade=%s  escalations=%d",
        result.cycle_id,
        result.aqs,
        result.grade,
        len(result.escalations_fired),
    )

    for dim in result.dimensions:
        log.info(
            "  %-14s weight=%.2f  score=%6.2f  weighted=%5.2f",
            dim.name,
            dim.weight,
            dim.score,
            dim.weighted,
        )

    for esc in result.escalations_fired:
        log.warning("ESCALATION  signal=%s  message=%s", esc["signal"], esc["message"])

    if dry_run:
        print(json.dumps(result_dict, indent=2, default=str))
        return result_dict

    # 4. Persist output
    if output_file is None:
        out_path = _write_output(output_dir, result_dict, result.cycle_id)
    else:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(json.dumps(result_dict, indent=2, default=str))
        out_path = output_file

    log.info("AQS result written to %s", out_path)

    # 5. Append to rolling history
    _append_history(history_file, result_dict)
    log.info("History updated at %s", history_file)

    return result_dict


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Compute AQS from latest test-cycle JSON")
    p.add_argument("--cycle-file", type=Path, default=None, help="Explicit cycle JSON path")
    p.add_argument("--output-file", type=Path, default=None, help="Explicit output path")
    p.add_argument("--history-file", type=Path, default=DEFAULT_HISTORY_FILE)
    p.add_argument("--cycle-dir", type=Path, default=DEFAULT_CYCLE_DIR)
    p.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    p.add_argument("--dry-run", action="store_true", help="Print result but do not write files")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    run(
        cycle_file=args.cycle_file,
        output_file=args.output_file,
        history_file=args.history_file,
        cycle_dir=args.cycle_dir,
        output_dir=args.output_dir,
        dry_run=args.dry_run,
    )
