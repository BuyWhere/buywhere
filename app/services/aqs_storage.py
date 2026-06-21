"""AQS Postgres storage writer.

Persists AQSResult dicts (from `app.services.aqs_calculator`) to the
`aqs_cycles` table that `api/src/migrate.ts` creates at API startup.

Used by:
  - `scripts/aqs_calculator.py --store` (CI / scheduled run)
  - Local Python invocations during validation

The connection is a single psycopg connection (no pooling needed for the
write-once-per-cycle cadence). On any error the function raises — the
caller decides whether to retry or fall back to the JSONL file.
"""
from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any, Mapping

log = logging.getLogger("aqs-storage")


def _conn_string_from_env() -> str:
    url = os.environ.get("DATABASE_URL") or os.environ.get("AQS_DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL (or AQS_DATABASE_URL) is not set; cannot persist AQS result"
        )
    return url


def _import_psycopg():
    try:
        import psycopg  # type: ignore
        return psycopg, psycopg.__version__
    except ImportError:
        pass
    try:
        import psycopg2 as psycopg  # type: ignore
        return psycopg, psycopg2.__version__
    except ImportError as e:
        raise RuntimeError(
            "Neither psycopg (v3) nor psycopg2 is installed; "
            "run `pip install psycopg2-binary` or `pip install psycopg[binary]`"
        ) from e


def _jsonify(payload: Mapping[str, Any] | None) -> str | None:
    if payload is None:
        return None
    return json.dumps(payload, default=str)


def store_aqs_cycle(result: Mapping[str, Any], *, database_url: str | None = None,
                    source: str = "github-actions") -> int:
    """Insert or update a single AQS cycle row. Returns the affected row id.

    The row is keyed on `cycle_id`; a re-run of the same cycle id is an
    upsert (ON CONFLICT ... DO UPDATE). This makes the workflow idempotent
    across retries without producing duplicate rows.
    """
    psycopg, version = _import_psycopg()
    conn_str = database_url or _conn_string_from_env()

    cycle_id = str(result.get("cycle_id") or "").strip()
    if not cycle_id:
        raise ValueError("result.cycle_id is required")
    aqs = result.get("aqs")
    if aqs is None:
        raise ValueError("result.aqs is required")
    grade = str(result.get("grade") or "Unusable")
    computed_at = result.get("computed_at")
    if not computed_at:
        raise ValueError("result.computed_at is required")

    dimensions = _jsonify(result.get("dimensions")) or "[]"
    sub_metrics = _jsonify(result.get("sub_metrics"))
    escalations = _jsonify(result.get("escalations_fired")) or "[]"
    raw_payload = _jsonify(result)
    escalations_count = len(result.get("escalations_fired") or [])

    log.info(
        "Persisting aqs_cycles cycle_id=%s aqs=%s grade=%s escalations=%d (psycopg %s)",
        cycle_id, aqs, grade, escalations_count, version,
    )

    with psycopg.connect(conn_str) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO aqs_cycles (
                    cycle_id, computed_at, aqs, grade, escalations_count,
                    dimensions, sub_metrics, escalations, raw_payload, source
                )
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s)
                ON CONFLICT (cycle_id) DO UPDATE SET
                    computed_at       = EXCLUDED.computed_at,
                    aqs               = EXCLUDED.aqs,
                    grade             = EXCLUDED.grade,
                    escalations_count = EXCLUDED.escalations_count,
                    dimensions        = EXCLUDED.dimensions,
                    sub_metrics       = EXCLUDED.sub_metrics,
                    escalations       = EXCLUDED.escalations,
                    raw_payload       = EXCLUDED.raw_payload,
                    source            = EXCLUDED.source
                RETURNING id
                """,
                (
                    cycle_id, computed_at, aqs, grade, escalations_count,
                    dimensions, sub_metrics, escalations, raw_payload, source,
                ),
            )
            row = cur.fetchone()
        conn.commit()
    return int(row[0]) if row else -1


if __name__ == "__main__":
    # Manual usage: python -m app.services.aqs_storage <path-to-aqs-result.json>
    if len(sys.argv) != 2:
        print("usage: python -m app.services.aqs_storage <aqs-result.json>", file=sys.stderr)
        sys.exit(2)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    payload_path = sys.argv[1]
    with open(payload_path) as f:
        payload = json.load(f)
    row_id = store_aqs_cycle(payload)
    print(f"stored aqs_cycles id={row_id} cycle_id={payload.get('cycle_id')}")
