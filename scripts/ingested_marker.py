#!/usr/bin/env python3
"""
ingested_marker — BUY-81741

Provides finalize_marker() and marker_path_for() for the buy30620 lane
ingest pipeline.

These functions are called by ingest_buy30620_lanes.py after each cycle file
is upserted into the catalog. They:

  1. Write a ``<ndjson>.ingested.json`` sibling marker with ingest stats.
  2. Upload the NDJSON to R2 under ``scrape-archive/<lane>/<basename>``.
  3. Record the R2 key in the marker so ``safe-data-cleanup.sh`` Gate D
     can verify durable storage without a live R2 HEAD probe.

Marker format (v2, consumed by safe-data-cleanup.sh Gate D):
{
  "version": 2,
  "r2": {
    "key": "scrape-archive/buy30620-<lane>/cycle-123-...ndjson",
    "uploadedAt": "<ISO timestamp>",
    "size": 1234567
  },
  "ingest": {
    "records": 5000,
    "inserted": 4800,
    "errors": 200,
    "writer": "ingest_buy30620_lanes.py:BUY-33177:crate",
    "completedAt": "<ISO timestamp>"
  }
}

Usage (called from ingest_buy30620_lanes.py):
    from scripts.ingested_marker import finalize_marker, marker_path_for
    summary = finalize_marker(ndjson_path, record_count=5000, inserted=4800,
                             errors=200, writer="ingest_buy30620_lanes.py:BUY-33177:crate",
                             require_r2=True)

Environment (read at import time):
    R2_RCLONE_REMOTE   Remote name configured in rclone.conf for the buywhere-data
                        bucket. Default: "buywhere-r2".
    R2_LANE_PREFIX     Prefix for R2 key construction.
                        Default: "scrape-archive" (so key = scrape-archive/buy30620-<lane>/...).
                        Set to empty string to omit the prefix.
"""
from __future__ import annotations

import datetime
import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

R2_REMOTE: str = os.environ.get("R2_RCLONE_REMOTE", "buywhere-r2")
R2_LANE_PREFIX: str = os.environ.get("R2_LANE_PREFIX", "scrape-archive")

# ── Public API ────────────────────────────────────────────────────────────────

def marker_path_for(ndjson_path: Path | str) -> Path:
    """Return the path to the ingested marker for a given NDJSON file."""
    return Path(ndjson_path).with_suffix(".ndjson.ingested.json")


def finalize_marker(
    ndjson_path: Path | str,
    *,
    record_count: int,
    inserted: int,
    errors: int,
    writer: str = "unknown",
    require_r2: bool = True,
) -> dict[str, Any]:
    """
    Write an ingested marker and (optionally) upload the NDJSON to R2.

    Parameters
    ----------
    ndjson_path:
        Path to the cycle NDJSON file (e.g. ``data/buy30620-crate/cycle-123-...ndjson``).
    record_count:
        Total records parsed from the file.
    inserted:
        Rows upserted into the catalog.
    errors:
        Rows that errored during upsert.
    writer:
        Identifier for the calling script (e.g. ``"ingest_buy30620_lanes.py:BUY-33177:crate"``).
    require_r2:
        If True (default), re-raises any R2 upload error so the caller can decide
        whether to proceed without a marker. If False, swallows R2 errors and writes
        the marker with ``r2Error`` set (legacy path).

    Returns
    -------
    dict with keys:
        markerWritten (bool)
        r2Key (str or None) — R2 key if upload succeeded
        error (str or None)
        partial (bool) — True if R2 upload failed but marker was written
    """
    ndjson_path = Path(ndjson_path)
    marker_path = marker_path_for(ndjson_path)
    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()

    r2_info: dict[str, Any] = {"uploaded": False}
    partial = False

    # Build R2 key from the file's lane directory
    r2_key = _build_r2_key(ndjson_path)

    # Upload to R2 (non-fatal — marker is always written)
    if r2_key:
        try:
            size = _upload_to_r2(ndjson_path, r2_key)
            r2_info = {
                "uploaded": True,
                "key": r2_key,
                "uploadedAt": ts,
                "size": size,
            }
            logger.info("R2 upload OK: %s:%s (%.1f KB)", R2_REMOTE, r2_key, size / 1024)
        except R2UploadError as exc:
            logger.warning("R2 upload failed (require_r2=%s): %s", require_r2, exc)
            r2_info = {
                "uploaded": False,
                "error": str(exc),
                "key": None,
            }
            partial = True
            if require_r2:
                raise

    marker: dict[str, Any] = {
        "version": 2,
        "r2": r2_info,
        "ingest": {
            "records": record_count,
            "inserted": inserted,
            "errors": errors,
            "writer": writer,
            "completedAt": ts,
        },
    }

    # Write marker atomically: write to temp, then rename
    tmp = marker_path.with_suffix(marker_path.suffix + ".tmp")
    try:
        tmp.write_text(json.dumps(marker, indent=2), encoding="utf-8")
        tmp.replace(marker_path)
        logger.info("Marker written: %s", marker_path)
    except OSError as exc:
        logger.error("Failed to write marker %s: %s", marker_path, exc)
        raise

    return {
        "markerWritten": True,
        "r2Key": r2_info.get("key"),
        "error": r2_info.get("error"),
        "partial": partial,
    }


# ── Internal helpers ──────────────────────────────────────────────────────────

def _build_r2_key(ndjson_path: Path) -> str | None:
    """
    Derive the R2 key for a cycle NDJSON file.

    Expected local path shapes:
      data/buy30620-crate/cycle-123-2026-09-09T05-27.ndjson
      data/buy30620-hunt2/cycle-456-2026-09-09T08-18.ndjson

    R2 key shape:
      scrape-archive/buy30620-crate/cycle-123-2026-09-09T05-27.ndjson
    """
    parts = ndjson_path.parts
    # Find the buy30620-* segment
    for i, part in enumerate(parts):
        if part.startswith("buy30620-"):
            # Everything from this segment onward is the R2 key path
            key_parts = parts[i:]
            break
    else:
        # Fallback: use just the filename, no prefix
        return ndjson_path.name if R2_LANE_PREFIX else ndjson_path.name

    if R2_LANE_PREFIX:
        return f"{R2_LANE_PREFIX}/{'/'.join(key_parts)}"
    return "/".join(key_parts)


class R2UploadError(Exception):
    """Raised when rclone fails to upload to R2."""
    pass


def _upload_to_r2(ndjson_path: Path, r2_key: str) -> int:
    """
    Upload a file to R2 using rclone copyto.

    Returns the file size in bytes on success.

    Raises R2UploadError on failure.
    """
    if not ndjson_path.is_file():
        raise R2UploadError(f"File not found: {ndjson_path}")

    size = ndjson_path.stat().st_size
    remote_path = f"{R2_REMOTE}:{r2_key}"

    try:
        result = subprocess.run(
            ["rclone", "copyto", str(ndjson_path), remote_path,
             "--progress", "--log-level", "ERROR"],
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise R2UploadError("rclone timed out after 300s")
    except FileNotFoundError:
        raise R2UploadError("rclone binary not found in PATH")

    if result.returncode != 0:
        # Strip sensitive path info from error messages
        err = result.stderr.strip() or "unknown error"
        raise R2UploadError(f"rclone exited {result.returncode}: {err}")

    return size
