/**
 * AQS (Agent Quality Score) repository — Postgres read-side.
 *
 * Writes are owned by the .github/workflows/aqs-ingest.yml scheduled job
 * (which calls scripts/aqs_calculator.py --store against DATABASE_URL).
 * This module is read-only and powers:
 *   - GET /v1/aqs/cycles            (recent history)
 *   - GET /v1/aqs/cycles/:cycle_id  (single cycle)
 *   - GET /v1/aqs/latest            (most recent)
 *   - GET /v1/aqs/health            (table + writer liveness)
 *
 * Schema lives in api/src/migrate.ts → AQS_MIGRATION.
 */
import { db } from '../config';

export interface AqsCycle {
  id: number;
  cycle_id: string;
  computed_at: string;
  aqs: number;
  grade: string;
  escalations_count: number;
  dimensions: any[];
  sub_metrics: Record<string, unknown> | null;
  escalations: any[] | null;
  raw_payload: Record<string, unknown> | null;
  source: string;
  created_at: string;
}

interface RawRow {
  id: string | number;
  cycle_id: string;
  computed_at: Date;
  aqs: string | number;
  grade: string;
  escalations_count: number;
  dimensions: any;
  sub_metrics: any;
  escalations: any;
  raw_payload: any;
  source: string;
  created_at: Date;
}

function normaliseRow(row: RawRow): AqsCycle {
  return {
    id: Number(row.id),
    cycle_id: row.cycle_id,
    computed_at: row.computed_at.toISOString(),
    aqs: Number(row.aqs),
    grade: row.grade,
    escalations_count: Number(row.escalations_count),
    dimensions: row.dimensions ?? [],
    sub_metrics: row.sub_metrics ?? null,
    escalations: row.escalations ?? [],
    raw_payload: row.raw_payload ?? null,
    source: row.source,
    created_at: row.created_at.toISOString(),
  };
}

export async function listRecentCycles(limit: number, market?: string): Promise<AqsCycle[]> {
  // market is reserved for a future multi-market column; the table is currently
  // global so we don't filter on it, but accepting it keeps the API stable.
  void market;
  const safeLimit = Math.min(Math.max(parseInt(String(limit), 10) || 25, 1), 200);
  const result = await db.query(
    `SELECT id, cycle_id, computed_at, aqs, grade, escalations_count,
            dimensions, sub_metrics, escalations, raw_payload, source, created_at
       FROM aqs_cycles
       ORDER BY computed_at DESC
       LIMIT $1`,
    [safeLimit]
  );
  return result.rows.map((row: RawRow) => normaliseRow(row));
}

export async function getCycleById(cycleId: string): Promise<AqsCycle | null> {
  if (!cycleId || cycleId.length > 200) return null;
  const result = await db.query(
    `SELECT id, cycle_id, computed_at, aqs, grade, escalations_count,
            dimensions, sub_metrics, escalations, raw_payload, source, created_at
       FROM aqs_cycles
       WHERE cycle_id = $1
       LIMIT 1`,
    [cycleId]
  );
  if (result.rows.length === 0) return null;
  return normaliseRow(result.rows[0] as RawRow);
}

export async function getLatestCycle(): Promise<AqsCycle | null> {
  const result = await db.query(
    `SELECT id, cycle_id, computed_at, aqs, grade, escalations_count,
            dimensions, sub_metrics, escalations, raw_payload, source, created_at
       FROM aqs_cycles
       ORDER BY computed_at DESC
       LIMIT 1`
  );
  if (result.rows.length === 0) return null;
  return normaliseRow(result.rows[0] as RawRow);
}

export interface AqsHealth {
  table_present: boolean;
  total_rows: number;
  last_cycle_at: string | null;
  last_source: string | null;
  latest_aqs: number | null;
  latest_grade: string | null;
}

export async function getHealth(): Promise<AqsHealth> {
  const exists = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'aqs_cycles'
     ) AS present`
  );
  const present = Boolean(exists.rows[0]?.present);
  if (!present) {
    return {
      table_present: false,
      total_rows: 0,
      last_cycle_at: null,
      last_source: null,
      latest_aqs: null,
      latest_grade: null,
    };
  }
  const summary = await db.query(
    `SELECT COUNT(*)::bigint AS cnt,
            MAX(computed_at) AS last_at,
            (SELECT aqs FROM aqs_cycles ORDER BY computed_at DESC LIMIT 1) AS latest_aqs,
            (SELECT grade FROM aqs_cycles ORDER BY computed_at DESC LIMIT 1) AS latest_grade,
            (SELECT source FROM aqs_cycles ORDER BY computed_at DESC LIMIT 1) AS latest_source
       FROM aqs_cycles`
  );
  const row = summary.rows[0] ?? {};
  return {
    table_present: true,
    total_rows: Number(row.cnt || 0),
    last_cycle_at: row.last_at ? new Date(row.last_at).toISOString() : null,
    last_source: row.latest_source ?? null,
    latest_aqs: row.latest_aqs !== null && row.latest_aqs !== undefined ? Number(row.latest_aqs) : null,
    latest_grade: row.latest_grade ?? null,
  };
}
