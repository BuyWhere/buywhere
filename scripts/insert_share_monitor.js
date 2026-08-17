#!/usr/bin/env node
'use strict';

/**
 * insert_share_monitor.js — BUY-70347
 *
 * Per-lane insert-share metric: emit insert_share = rows_inserted/(rows_inserted+rows_updated)
 * per lane per hour, and alert on a >30 percentage-point drop between consecutive hours.
 *
 * The 2026-08-13 incident showed insert_share fell 96.1% → 53.4% → 38.7% a full day
 * before the hourly FAILs went continuous — it was the leading indicator.
 *
 * Metrics emitted (JSON to stdout):
 *   - per-lane per-hour: source, hour, rows_inserted, rows_updated, insert_share
 *   - per-lane: latest_share, previous_share, drop_pts, verdict
 *   - overall: pass/fail + list of lanes with drops
 *
 * Exit codes:
 *   0 = all lanes within tolerance
 *   2 = one or more lanes have insert-share drop > 30pts
 *
 * Usage:
 *   DATABASE_URL=... node scripts/insert_share_monitor.js [--json] [--drop-threshold 30] [--hours-back 6]
 */

const { Client } = require('pg');

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_DROP_THRESHOLD_PTS = 30;   // 30 percentage-point drop
const DEFAULT_HOURS_BACK = 6;

function buildClient() {
  const raw = process.env.CANONICAL_DATABASE_URL || process.env.MAGLEV_DB_URL || process.env.DATABASE_URL || process.env.BUYWHERE_DATABASE_URL;
  if (!raw) throw new Error('Set CANONICAL_DATABASE_URL, MAGLEV_DB_URL, DATABASE_URL, or BUYWHERE_DATABASE_URL for the canonical DB.');
  return new Client({
    connectionString: raw,
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || DEFAULT_CONNECTION_TIMEOUT_MS),
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || DEFAULT_STATEMENT_TIMEOUT_MS),
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    json: false,
    dropThreshold: DEFAULT_DROP_THRESHOLD_PTS,
    hoursBack: DEFAULT_HOURS_BACK,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') opts.json = true;
    else if (args[i] === '--drop-threshold') opts.dropThreshold = Number(args[++i]) || DEFAULT_DROP_THRESHOLD_PTS;
    else if (args[i] === '--hours-back') opts.hoursBack = Number(args[++i]) || DEFAULT_HOURS_BACK;
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const client = buildClient();
  await client.connect();

  try {
    // 1. Compute per-lane per-hour insert_share from ingestion_runs
    //    Bucket runs into hour buckets by started_at
    const hourlyResult = await client.query(`
      WITH lane_hours AS (
        SELECT
          source,
          date_trunc('hour', started_at) AS hour_bucket,
          SUM(COALESCE(rows_inserted, 0)) AS total_inserted,
          SUM(COALESCE(rows_updated, 0)) AS total_updated,
          COUNT(*) AS run_count
        FROM ingestion_runs
        WHERE status IN ('completed', 'completed_with_issues')
          AND started_at >= NOW() - INTERVAL '${opts.hoursBack + 1} hours'
        GROUP BY source, date_trunc('hour', started_at)
      )
      SELECT
        source,
        hour_bucket,
        total_inserted,
        total_updated,
        CASE
          WHEN (total_inserted + total_updated) = 0 THEN NULL
          ELSE ROUND((total_inserted::numeric / (total_inserted + total_updated)) * 100, 1)
        END AS insert_share_pct,
        run_count
      FROM lane_hours
      ORDER BY source, hour_bucket DESC
    `);

    // 2. Group by source, compute consecutive-hour drops
    const bySource = {};
    for (const row of hourlyResult.rows) {
      if (!bySource[row.source]) bySource[row.source] = [];
      bySource[row.source].push({
        hour_bucket: row.hour_bucket,
        total_inserted: Number(row.total_inserted),
        total_updated: Number(row.total_updated),
        insert_share_pct: row.insert_share_pct !== null ? Number(row.insert_share_pct) : null,
        run_count: Number(row.run_count),
      });
    }

    const laneResults = [];
    const alertLanes = [];

    for (const [source, hours] of Object.entries(bySource)) {
      // Already sorted DESC by hour_bucket
      const latest = hours[0];
      const previous = hours.length >= 2 ? hours[1] : null;

      let drop_pts = null;
      if (latest.insert_share_pct !== null && previous && previous.insert_share_pct !== null) {
        drop_pts = Math.round((previous.insert_share_pct - latest.insert_share_pct) * 10) / 10;
      }

      const verdict = (drop_pts !== null && drop_pts > opts.dropThreshold) ? 'ALERT' : 'OK';
      if (verdict === 'ALERT') alertLanes.push(source);

      laneResults.push({
        source,
        latest_hour: latest.hour_bucket,
        latest_inserted: latest.total_inserted,
        latest_updated: latest.total_updated,
        latest_insert_share_pct: latest.insert_share_pct,
        previous_hour: previous ? previous.hour_bucket : null,
        previous_insert_share_pct: previous ? previous.insert_share_pct : null,
        drop_pts,
        hourly_history: hours.slice(0, 8).map(h => ({
          hour: h.hour_bucket,
          insert_share_pct: h.insert_share_pct,
          inserted: h.total_inserted,
          updated: h.total_updated,
        })),
        verdict,
      });
    }

    const overall = alertLanes.length === 0 ? 'PASS' : 'FAIL';

    const report = {
      check: 'insert_share_monitor',
      overall,
      drop_threshold_pts: opts.dropThreshold,
      hours_back: opts.hoursBack,
      alert_lanes: alertLanes,
      lanes: laneResults.sort((a, b) => {
        if (a.verdict === 'ALERT' && b.verdict !== 'ALERT') return -1;
        if (a.verdict !== 'ALERT' && b.verdict === 'ALERT') return 1;
        return (a.drop_pts || 0) - (b.drop_pts || 0);
      }),
      timestamp: new Date().toISOString(),
    };

    if (opts.json) {
      process.stdout.write(JSON.stringify(report) + "\n");
    } else {
      console.log(`\n=== Insert-Share Monitor ===`);
      console.log(`Overall: ${overall}`);
      console.log(`Drop threshold: >${opts.dropThreshold} percentage points`);
      console.log(`Hours examined: ${opts.hoursBack}`);
      console.log(`Alert lanes: ${alertLanes.length > 0 ? alertLanes.join(', ') : 'none'}`);
      console.log('');
      for (const lane of report.lanes) {
        const icon = lane.verdict === 'ALERT' ? 'ALERT' : '   OK';
        console.log(`  [${icon}] ${lane.source}`);
        if (lane.latest_insert_share_pct !== null) {
          console.log(`       latest: ${lane.latest_insert_share_pct}% (${lane.latest_inserted.toLocaleString()} ins / ${lane.latest_updated.toLocaleString()} upd)`);
        } else {
          console.log(`       latest: n/a (no upserts this hour)`);
        }
        if (lane.drop_pts !== null) {
          console.log(`       prev:   ${lane.previous_insert_share_pct}% | drop: ${lane.drop_pts}pts`);
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
  console.error(`insert_share_monitor: ${err.message}`);
  process.exit(2);
});
