#!/usr/bin/env node
/**
 * source_mix_freshness_check.js — BUY-64988 reconciliation guardrail
 *
 * Reconciles ingestion_runs.rows_inserted against COUNT(products.created_at)
 * for the trailing N hours (default 24) and writes a row per (hour, source)
 * to canonical_throughput_hourly with a reconciliation_status of:
 *
 *   ok      | gap <  10% AND absolute gap < 10 rows
 *   warn    | 10% <= gap < 25% OR absolute gap >= 10 rows
 *   drift   | gap >= 25%  (writer/counter divergence)
 *   no_data | both counts are zero (no ingestion in this hour)
 *
 * Exits non-zero when any hour has reconciliation_status = drift. The drift
 * state reproduces the BUY-64337 failure mode where the writer's counter
 * advanced but products.created_at did not, so downstream throughput reports
 * cannot trust ing_inserted as proof-of-progress.
 *
 * Usage:
 *   node scripts/source_mix_freshness_check.js                   # trailing 24h
 *   node scripts/source_mix_freshness_check.js --hours 48
 *   node scripts/source_mix_freshness_check.js --source magento
 *   node scripts/source_mix_freshness_check.js --json
 *   node scripts/source_mix_freshness_check.js --dry-run
 *
 * Required env:
 *   DATABASE_URL   Postgres connection string
 */

import pg from 'pg';

const DEFAULT_HOURS = 24;
const THRESHOLD_PCT = 10.0;
const ABS_GAP_WARN   = 10;

function parseArgs(argv) {
  const args = { hours: DEFAULT_HOURS, json: false, dryRun: false, source: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hours')    { args.hours = parseInt(argv[++i], 10); }
    else if (a === '--json')    { args.json = true; }
    else if (a === '--dry-run') { args.dryRun = true; }
    else if (a === '--source')  { args.source = argv[++i]; }
  }
  return args;
}

function classify(gapAbs, gapPct, totalA) {
  if (totalA === 0) return 'no_data';
  if (gapAbs === 0) return 'ok';
  if (gapPct < THRESHOLD_PCT && gapAbs < ABS_GAP_WARN) return 'ok';
  if (gapPct < 25.0) return 'warn';
  return 'drift';
}

async function main() {
  const args = parseArgs(process.argv);
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error('[freshness] DATABASE_URL not set');
    process.exit(2);
  }

  const client = new pg.Client({ connectionString: connStr });
  await client.connect();

  try {
    const params = [args.hours];
    let sourceFilter = '';
    if (args.source) {
      sourceFilter = 'AND r.source = $2';
      params.push(args.source);
    }

    const reconcileSql = `
      WITH hours AS (
        SELECT date_trunc('hour', NOW() - (INTERVAL '1 hour' * g)) AS hour
        FROM generate_series(0, $1 - 1) AS g
      ),
      runs AS (
        SELECT date_trunc('hour', started_at) AS hour,
               source,
               SUM(COALESCE(rows_inserted, 0)) AS rows_inserted
          FROM ingestion_runs
         WHERE started_at >= NOW() - (INTERVAL '1 hour' * $1)
         ${sourceFilter}
         GROUP BY 1, 2
      ),
      products AS (
        SELECT date_trunc('hour', created_at) AS hour,
               source,
               COUNT(*) AS cnt
          FROM products
         WHERE created_at >= NOW() - (INTERVAL '1 hour' * $1)
         ${sourceFilter}
         GROUP BY 1, 2
      )
      SELECT h.hour,
             COALESCE(r.source, p.source) AS source,
             COALESCE(r.rows_inserted, 0) AS ingestion_runs_rows_inserted,
             COALESCE(p.cnt, 0)           AS products_created_at_count
        FROM hours h
        LEFT JOIN runs      r ON r.hour = h.hour
        LEFT JOIN products  p ON p.hour = h.hour AND p.source = COALESCE(r.source, p.source)
    `;

    const { rows } = await client.query(reconcileSql, params);

    const summary = [];
    for (const r of rows) {
      const totalA = Number(r.ingestion_runs_rows_inserted);
      const totalB = Number(r.products_created_at_count);
      const gapAbs = Math.abs(totalA - totalB);
      const denom = Math.max(totalA, totalB, 1);
      const gapPct = (gapAbs / denom) * 100;
      const status = classify(gapAbs, gapPct, totalA + totalB);
      summary.push({
        hour: r.hour,
        source: r.source,
        ingestion_runs_rows_inserted: totalA,
        products_created_at_count: totalB,
        gap_abs: gapAbs,
        gap_pct: Number(gapPct.toFixed(4)),
        threshold_pct: THRESHOLD_PCT,
        reconciliation_status: status,
      });
    }

    const upsertSql = `
      INSERT INTO canonical_throughput_hourly
        (hour, source, ingestion_runs_rows_inserted, products_created_at_count,
         gap_abs, gap_pct, threshold_pct, reconciliation_status, last_checked_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (hour, source) DO UPDATE SET
        ingestion_runs_rows_inserted = EXCLUDED.ingestion_runs_rows_inserted,
        products_created_at_count    = EXCLUDED.products_created_at_count,
        gap_abs                      = EXCLUDED.gap_abs,
        gap_pct                      = EXCLUDED.gap_pct,
        threshold_pct                = EXCLUDED.threshold_pct,
        reconciliation_status        = EXCLUDED.reconciliation_status,
        last_checked_at              = NOW()
    `;

    if (!args.dryRun) {
      for (const s of summary) {
        await client.query(upsertSql, [
          s.hour,
          s.source,
          s.ingestion_runs_rows_inserted,
          s.products_created_at_count,
          s.gap_abs,
          s.gap_pct,
          s.threshold_pct,
          s.reconciliation_status,
        ]);
      }
    }

    if (args.json) {
      console.log(JSON.stringify({ hours: args.hours, rows: summary }, null, 2));
    } else {
      console.log(`[freshness] ${args.hours}h window, ${summary.length} (hour,source) rows`);
      const counts = summary.reduce((acc, r) => {
        acc[r.reconciliation_status] = (acc[r.reconciliation_status] || 0) + 1;
        return acc;
      }, {});
      for (const [k, v] of Object.entries(counts)) {
        console.log(`[freshness]   ${k}: ${v}`);
      }
    }

    const driftRows = summary.filter((s) => s.reconciliation_status === 'drift');
    if (driftRows.length > 0) {
      if (!args.json) {
        console.error(`[freshness] DRIFT detected in ${driftRows.length} (hour,source) pairs`);
        for (const d of driftRows.slice(0, 10)) {
          console.error(
            `  ${d.hour.toISOString()} ${d.source}: ` +
            `runs=${d.ingestion_runs_rows_inserted} created_at=${d.products_created_at_count} ` +
            `gap_pct=${d.gap_pct}%`,
          );
        }
      }
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[freshness] fatal:', err.message || err);
  process.exit(2);
});