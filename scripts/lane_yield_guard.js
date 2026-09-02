#!/usr/bin/env node
'use strict';

/**
 * lane_yield_guard.js — BUY-70347
 *
 * Per-lane yield guard: FAIL when a lane's rows_inserted/run is below ~20%
 * of its trailing 7-day median for 3 consecutive completed runs.
 *
 * This catches the hunt2/stock collapse pattern: drains silently drop from
 * ~30K inserts/run to ~30 while reporting status=completed.
 *
 * Metrics emitted (JSON to stdout):
 *   - per-lane: source, trailing_median, recent_runs[], consecutive_below, verdict
 *   - overall: pass/fail + list of failing lanes
 *
 * Exit codes:
 *   0 = all lanes healthy
 *   2 = one or more lanes failing yield guard
 *
 * Usage:
 *   DATABASE_URL=... node scripts/lane_yield_guard.js [--json] [--threshold 0.2] [--consecutive 3]
 */

const { Client } = require('pg');

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_YIELD_THRESHOLD = 0.20;   // 20% of trailing median
const DEFAULT_CONSECUTIVE_RUNS = 3;      // consecutive runs below threshold
const TRAILING_WINDOW_DAYS = 7;
const MIN_RUNS_FOR_MEDIAN = 5;          // need at least 5 runs to compute meaningful median

function buildClient() {
  const raw = process.env.CATALOG_DATABASE_URL || process.env.CANONICAL_DATABASE_URL || process.env.BUYWHERE_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error('Set CATALOG_DATABASE_URL / CANONICAL_DATABASE_URL / BUYWHERE_DATABASE_URL.');
  if (/roundhouse/i.test(raw)) throw new Error('Refusing control-plane DSN (roundhouse).');
  return new Client({
    connectionString: raw,
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || DEFAULT_CONNECTION_TIMEOUT_MS),
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || DEFAULT_STATEMENT_TIMEOUT_MS),
  });
}

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    json: false,
    threshold: DEFAULT_YIELD_THRESHOLD,
    consecutive: DEFAULT_CONSECUTIVE_RUNS,
    hoursBack: 24,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') opts.json = true;
    else if (args[i] === '--threshold') opts.threshold = Number(args[++i]) || DEFAULT_YIELD_THRESHOLD;
    else if (args[i] === '--consecutive') opts.consecutive = Number(args[++i]) || DEFAULT_CONSECUTIVE_RUNS;
    else if (args[i] === '--hours-back') opts.hoursBack = Number(args[++i]) || 24;
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const client = buildClient();
  await client.connect();

  try {
    // 1. Get trailing 7-day median rows_inserted per source (completed runs only)
    const medianResult = await client.query(`
      SELECT
        source,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(rows_inserted, 0)) AS trailing_median,
        COUNT(*) AS run_count
      FROM ingestion_runs
      WHERE status IN ('completed', 'completed_with_issues')
        AND started_at >= NOW() - INTERVAL '${TRAILING_WINDOW_DAYS} days'
      GROUP BY source
      HAVING COUNT(*) >= $1
    `, [MIN_RUNS_FOR_MEDIAN]);

    const laneMedians = {};
    for (const row of medianResult.rows) {
      laneMedians[row.source] = {
        trailing_median: Number(row.trailing_median),
        run_count: Number(row.run_count),
      };
    }

    // 2. Get most recent N completed runs per source
    const recentResult = await client.query(`
      WITH ranked AS (
        SELECT
          source,
          COALESCE(rows_inserted, 0) AS rows_inserted,
          COALESCE(rows_updated, 0) AS rows_updated,
          status,
          started_at,
          ROW_NUMBER() OVER (PARTITION BY source ORDER BY started_at DESC) AS rn
        FROM ingestion_runs
        WHERE status IN ('completed', 'completed_with_issues')
          AND started_at >= NOW() - INTERVAL '${opts.hoursBack} hours'
      )
      SELECT * FROM ranked WHERE rn <= $1
    `, [opts.consecutive + 1]);

    // Group recent runs by source
    const recentBySource = {};
    for (const row of recentResult.rows) {
      if (!recentBySource[row.source]) recentBySource[row.source] = [];
      recentBySource[row.source].push({
        rows_inserted: Number(row.rows_inserted),
        rows_updated: Number(row.rows_updated),
        started_at: row.started_at,
        rn: Number(row.rn),
      });
    }

    // 3. Evaluate yield guard per lane
    const laneResults = [];
    const failingLanes = [];

    for (const [source, meta] of Object.entries(laneMedians)) {
      const recent = recentBySource[source] || [];
      // Sort by rn ascending (oldest first) to check consecutive from tail
      recent.sort((a, b) => a.rn - b.rn);

      // Check the last N runs against threshold
      const lastN = recent.slice(-opts.consecutive);
      let consecutiveBelow = 0;

      for (const run of lastN) {
        if (meta.trailing_median > 0 && (run.rows_inserted / meta.trailing_median) < opts.threshold) {
          consecutiveBelow++;
        } else {
          consecutiveBelow = 0; // reset on any healthy run
        }
      }

      const verdict = consecutiveBelow >= opts.consecutive ? 'FAIL' : 'PASS';
      const laneResult = {
        source,
        trailing_median: meta.trailing_median,
        trailing_run_count: meta.run_count,
        recent_runs: recent.slice(-opts.consecutive).map(r => ({
          rows_inserted: r.rows_inserted,
          rows_updated: r.rows_updated,
          yield_pct: meta.trailing_median > 0
            ? Math.round((r.rows_inserted / meta.trailing_median) * 1000) / 10
            : null,
          started_at: r.started_at,
        })),
        consecutive_below_threshold: consecutiveBelow,
        verdict,
      };
      laneResults.push(laneResult);

      if (verdict === 'FAIL') {
        failingLanes.push(source);
      }
    }

    // Also check sources with recent runs but no median (new lanes)
    for (const [source, runs] of Object.entries(recentBySource)) {
      if (!laneMedians[source]) {
        laneResults.push({
          source,
          trailing_median: null,
          trailing_run_count: 0,
          recent_runs: runs.slice(-opts.consecutive).map(r => ({
            rows_inserted: r.rows_inserted,
            rows_updated: r.rows_updated,
            yield_pct: null,
            started_at: r.started_at,
          })),
          consecutive_below_threshold: 0,
          verdict: 'SKIP',
          reason: 'insufficient trailing data for median',
        });
      }
    }

    const overall = failingLanes.length === 0 ? 'PASS' : 'FAIL';

    const report = {
      check: 'lane_yield_guard',
      overall,
      threshold_pct: opts.threshold * 100,
      consecutive_required: opts.consecutive,
      trailing_window_days: TRAILING_WINDOW_DAYS,
      failing_lanes: failingLanes,
      lanes: laneResults.sort((a, b) => {
        if (a.verdict === 'FAIL' && b.verdict !== 'FAIL') return -1;
        if (a.verdict !== 'FAIL' && b.verdict === 'FAIL') return 1;
        return (a.trailing_median || 0) - (b.trailing_median || 0);
      }),
      timestamp: new Date().toISOString(),
    };

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`\n=== Lane Yield Guard ===`);
      console.log(`Overall: ${overall}`);
      console.log(`Threshold: ${opts.threshold * 100}% of trailing ${TRAILING_WINDOW_DAYS}-day median, ${opts.consecutive} consecutive runs`);
      console.log(`Lanes evaluated: ${laneResults.length}`);
      console.log(`Failing: ${failingLanes.length > 0 ? failingLanes.join(', ') : 'none'}`);
      console.log('');
      for (const lane of report.lanes) {
        const icon = lane.verdict === 'FAIL' ? 'FAIL' : lane.verdict === 'PASS' ? '  OK' : ' SKIP';
        console.log(`  [${icon}] ${lane.source}`);
        if (lane.trailing_median !== null) {
          console.log(`       median: ${Math.round(lane.trailing_median).toLocaleString()} | recent runs:`);
          for (const r of lane.recent_runs) {
            const yieldStr = r.yield_pct !== null ? `${r.yield_pct}%` : 'n/a';
            console.log(`         ${r.rows_inserted.toLocaleString()} ins / ${r.rows_updated.toLocaleString()} upd (${yieldStr})`);
          }
        } else {
          console.log(`       ${lane.reason}`);
        }
      }
      console.log('');
    }

    process.exit(overall === 'FAIL' ? 2 : 0);
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(`lane_yield_guard: ${err.message}`);
  process.exit(2);
});
