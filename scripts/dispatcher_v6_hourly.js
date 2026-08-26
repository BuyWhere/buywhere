#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { Client } = require('pg');

const TARGET_INSERTS_PER_HOUR = 150_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const SOURCE_V6 = 'v6';
const CYCLE_MARKER_DIRS = [
  'data/buy30590',
  'data/buy30620-crate',
  'data/buy30620-hunt2',
  'data/buy30620-stock',
  'data/buy31015-woocommerce-deep',
];

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value) {
  const number = toNumber(value);
  return number === null ? 'NULL' : number.toLocaleString('en-US');
}

function formatPercent(value, target = TARGET_INSERTS_PER_HOUR) {
  const number = toNumber(value);
  if (number === null || !target) return 'n/a';
  return `${((number / target) * 100).toFixed(1)}%`;
}

function sqlTimestamp(date) {
  return date.toISOString().replace('T', ' ').replace('.000Z', '+00');
}

function completedHour(now = new Date()) {
  const hourStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours() - 1,
    0,
    0,
    0,
  );
  return new Date(hourStartMs);
}


function collectCycleMarkerInserted(hourStart, dataRoot) {
  const root = dataRoot || process.cwd();
  const hourEndMs = hourStart.getTime() + 60 * 60 * 1000;
  let totalInserted = 0;
  let totalCycles = 0;

  for (const dir of CYCLE_MARKER_DIRS) {
    const fullPath = path.resolve(root, dir);
    let entries;
    try {
      entries = fs.readdirSync(fullPath);
    } catch {
      continue; // directory may not exist on all hosts
    }
    for (const entry of entries) {
      if (!entry.endsWith('.ingested.json')) continue;
      try {
        const raw = fs.readFileSync(path.join(fullPath, entry), 'utf8');
        const marker = JSON.parse(raw);
        const ingestAt = marker?.ingest?.at;
        const inserted = marker?.ingest?.inserted;
        if (!ingestAt || typeof inserted !== 'number') continue;
        const markerTime = new Date(ingestAt).getTime();
        if (markerTime >= hourStart.getTime() && markerTime < hourEndMs) {
          totalInserted += inserted;
          totalCycles += 1;
        }
      } catch {
        // skip corrupt or unreadable markers
      }
    }
  }

  return { inserted: totalInserted, cycles: totalCycles };
}

function select_v6_throughput_signal(metrics, target = TARGET_INSERTS_PER_HOUR) {
  const deltaInsFromStats = toNumber(metrics?.delta_ins_from_stats);
  const ingInsertedRaw = toNumber(metrics?.ing_inserted);
  const ingInserted = ingInsertedRaw ?? 0;
  const ingRunsRaw = toNumber(metrics?.ing_runs);
  const liveCountDelta = toNumber(metrics?.live_count_delta);
  const nLiveTupDelta = toNumber(metrics?.n_live_tup_delta);
  const statResetDetected = Boolean(metrics?.stat_reset_detected);
  const frozenCounter = deltaInsFromStats === 0 && nLiveTupDelta === 0;

  // Drain-only guard: suppress false-positive FAIL when no ingestion runs occurred
  // (ing_runs=0, ing_inserted=null|0) but pg_stat shows delta_ins_from_stats > 0
  // (existing products moved/reindexed by drain). Classifies as PASS so no child
  // is filed, ending the 15+ consecutive drain-only FAIL-children streak.
  // DRAIN_ONLY_MAX_DELTA (2026-08-23, BUY-69897): cap the guard at a noise floor.
  // Uncapped, this guard PASSed every ing_runs=0 hour regardless of delta size,
  // masking genuine low-throughput hours (e.g. 2026-08-23 09Z delta=98,915 was
  // wrongly PASSed). Drain reindex noise observed historically is < ~30K/hour;
  // 50K is a conservative ceiling that still covers the drain-only streak hours.
  const drainOnlyMaxDelta = Number(process.env.DRAIN_ONLY_MAX_DELTA) || 50_000;
  const isDrainOnly = (
    deltaInsFromStats !== null &&
    deltaInsFromStats > 0 &&
    deltaInsFromStats < drainOnlyMaxDelta &&
    deltaInsFromStats < target &&
    ingRunsRaw !== null && ingRunsRaw === 0 &&
    (ingInsertedRaw == null || ingInsertedRaw === 0)
  );
  if (isDrainOnly) {
    return {
      verdict: 'PASS',
      value: deltaInsFromStats,
      source: 'drain_only_guard',
      reason: `drain-only: delta_ins_from_stats=${formatNumber(deltaInsFromStats)} < target=${formatNumber(target)} but ing_runs=${ingRunsRaw ?? 0}, ing_inserted=${ingInsertedRaw ?? 0} — no producer activity, false FAIL suppressed`,
    };
  }

  if (deltaInsFromStats !== null && deltaInsFromStats >= target) {
    return {
      verdict: 'PASS',
      value: deltaInsFromStats,
      source: 'delta_ins_from_stats',
      reason: `delta_ins_from_stats ${formatNumber(deltaInsFromStats)} >= ${formatNumber(target)}`,
    };
  }

  if (nLiveTupDelta !== null && nLiveTupDelta >= target) {
    // v6.4 ing_inserted corroboration: block the guard when canonical ing_inserted
    // is available AND below target (catches autovacuum bloat release producing a
    // large positive n_live_tup_delta while almost no rows were actually inserted).
    // When ing_inserted is unavailable (true first-ever tick / older runner versions)
    // or >= target, the guard still fires to preserve stale-counter protection.
    const ingInsertedBlocksGuard = ingInsertedRaw !== null && ingInsertedRaw < target;
    if (!ingInsertedBlocksGuard) {
      return {
        verdict: 'PASS',
        value: nLiveTupDelta,
        source: 'n_live_tup_delta_guard',
        reason: `n_live_tup_delta ${formatNumber(nLiveTupDelta)} >= ${formatNumber(target)} blocks stale-counter failure`,
      };
    }
    // Fall through: autovacuum bloat likely masked the real (low) ingest.
  }

  if (deltaInsFromStats === null || statResetDetected || frozenCounter) {
    if (liveCountDelta !== null && liveCountDelta >= target) {
      return {
        verdict: 'PASS',
        value: liveCountDelta,
        source: 'live_count_delta_fallback',
        reason: `stat reset/frozen counters/unavailable insert delta; live_count_delta ${formatNumber(liveCountDelta)} >= ${formatNumber(target)}`
      };
    }

    // Use ingestion_runs as fallback metric when pg_stat counters reset
    if (ingInsertedRaw !== null && ingInsertedRaw >= target) {
      return {
        verdict: 'PASS',
        value: ingInserted,
        source: 'ing_inserted_fallback',
        reason: `stat reset/frozen counters; ingestion_runs.ing_inserted ${formatNumber(ingInserted)} >= ${formatNumber(target)}`
      };
    }

    // Consult cycle-marker ground truth when ingestion_runs misses (BUY-43106 / BUY-66134).
    // The bulk ingester buy30331-ingest-stream.mjs writes ONLY .ingested.json cycle
    // markers and never logs to ingestion_runs, so ingestion_runs.ing_inserted can be
    // zero even during a high-volume hour.
    const cycleMarkerInserted = toNumber(metrics?.cycle_marker_inserted) ?? 0;
    if (cycleMarkerInserted >= target) {
      return {
        verdict: 'PASS',
        value: cycleMarkerInserted,
        source: 'cycle_marker_fallback',
        reason: `stat reset/frozen counters; cycle_marker_inserted ${formatNumber(cycleMarkerInserted)} >= ${formatNumber(target)} (bulk ingester ground truth)`
      };
    }

    return {
      verdict: 'FAIL',
      value: ingInserted,
      source: 'ing_inserted_fallback',
      reason: `stat reset/frozen counters; ingestion_runs.ing_inserted ${formatNumber(ingInserted)} < ${formatNumber(target)}, cycle_marker_inserted ${formatNumber(cycleMarkerInserted)} < ${formatNumber(target)}, no other guard met target`
    };
  }

  return {
    verdict: 'FAIL',
    value: deltaInsFromStats,
    source: 'delta_ins_from_stats',
    reason: `delta_ins_from_stats ${formatNumber(deltaInsFromStats)} < ${formatNumber(target)} and no v6 guard met target`,
  };
}

function should_file_v6_failure_ticket(metrics, target = TARGET_INSERTS_PER_HOUR) {
  return select_v6_throughput_signal(metrics, target).verdict === 'FAIL';
}

function buildConnectionString() {
  const raw = process.env.CANONICAL_DATABASE_URL || process.env.MAGLEV_DB_URL || process.env.DATABASE_URL || process.env.BUYWHERE_DATABASE_URL;
  if (!raw) {
    throw new Error('Set CANONICAL_DATABASE_URL, MAGLEV_DB_URL, DATABASE_URL, or BUYWHERE_DATABASE_URL for the canonical DB.');
  }
  return raw;
}

function buildClient() {
  return new Client({
    connectionString: buildConnectionString(),
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || DEFAULT_CONNECTION_TIMEOUT_MS),
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || DEFAULT_STATEMENT_TIMEOUT_MS),
  });
}

async function ensureCanonicalTable(client) {
  // Restore DDL-permission tolerance (regressed in 2d53dc31, BUY-72387 pull): cron
  // uses `ingest_rw` which lacks CREATE on schema public. The table is created and
  // maintained out-of-band by Ops; on this path we only verify it exists and skip
  // otherwise-fatal CREATE/ALTER permissions.
  const DDL_PERMISSION_ERR = '42501';
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS canonical_throughput_hourly (
        hour_start timestamptz PRIMARY KEY,
        n_tup_ins bigint,
        n_tup_upd bigint,
        n_live_tup bigint,
        live_count bigint,
        ing_runs integer DEFAULT 0,
        ing_inserted bigint DEFAULT 0,
        ing_updated bigint DEFAULT 0,
        delta_ins_from_stats bigint,
        delta_upd_from_stats bigint,
        stat_reset_detected boolean DEFAULT false,
        stats_mismatch_detected boolean DEFAULT false,
        stats_mismatch_reason text,
        delta_computed_at timestamptz,
        source text,
        last_check_result text,
        last_check_reason text,
        recorded_at timestamptz DEFAULT now()
      )
    `);

    const optionalColumns = [
      ['delta_ins_from_stats', 'bigint'],
      ['delta_upd_from_stats', 'bigint'],
      ['stat_reset_detected', 'boolean DEFAULT false'],
      ['stats_mismatch_detected', 'boolean DEFAULT false'],
      ['stats_mismatch_reason', 'text'],
      ['delta_computed_at', 'timestamptz'],
      ['source', 'text'],
      ['last_check_result', 'text'],
      ['last_check_reason', 'text'],
      ['reconciliation_status', 'text'],
      ['reconciliation_gap', 'bigint'],
      ['reconciliation_reason', 'text'],
      ['reconciliation_checked_at', 'timestamptz'],
    ];

    for (const [name, definition] of optionalColumns) {
      await client.query(`ALTER TABLE canonical_throughput_hourly ADD COLUMN IF NOT EXISTS ${name} ${definition}`);
    }
  } catch (err) {
    if (err.code !== DDL_PERMISSION_ERR) throw err;
    const check = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='canonical_throughput_hourly'`
    );
    if (check.rows.length === 0) {
      throw new Error('canonical_throughput_hourly missing and CREATE permission denied — cannot proceed');
    }
    console.error('[ensureCanonicalTable] DDL permission denied but table exists — continuing');
  }
}

async function upsertSnapshot(client, hourStart, { skipLiveCount = true } = {}) {
  const liveCountSql = skipLiveCount
    ? 'SELECT NULL::bigint AS live_count'
    : 'SELECT count(*)::bigint AS live_count FROM products';

  const result = await client.query(`\n    WITH children AS (
      SELECT i.inhrelid AS relid
      FROM pg_inherits i
      WHERE i.inhparent = 'products'::regclass
    ),
    stats AS (
      SELECT
        CASE WHEN EXISTS (SELECT 1 FROM children)
          THEN (SELECT COALESCE(SUM(s.n_tup_ins), 0) FROM pg_stat_user_tables s WHERE s.relid IN (SELECT relid FROM children) AND s.schemaname = 'public')
          ELSE (SELECT COALESCE(n_tup_ins, 0) FROM pg_stat_user_tables WHERE relname = 'products' AND schemaname = 'public')
        END AS n_tup_ins,
        CASE WHEN EXISTS (SELECT 1 FROM children)
          THEN (SELECT COALESCE(SUM(s.n_tup_upd), 0) FROM pg_stat_user_tables s WHERE s.relid IN (SELECT relid FROM children) AND s.schemaname = 'public')
          ELSE (SELECT COALESCE(n_tup_upd, 0) FROM pg_stat_user_tables WHERE relname = 'products' AND schemaname = 'public')
        END AS n_tup_upd,
        CASE WHEN EXISTS (SELECT 1 FROM children)
          THEN (SELECT COALESCE(SUM(s.n_live_tup), 0) FROM pg_stat_user_tables s WHERE s.relid IN (SELECT relid FROM children) AND s.schemaname = 'public')
          ELSE (SELECT COALESCE(n_live_tup, 0) FROM pg_stat_user_tables WHERE relname = 'products' AND schemaname = 'public')
        END AS n_live_tup
    ),
    live AS (${liveCountSql}),
    ing AS (
      SELECT
        count(*)::int AS runs,
        COALESCE(sum(rows_inserted), 0)::bigint AS sum_inserted,
        COALESCE(sum(rows_updated), 0)::bigint AS sum_updated
      FROM ingestion_runs
      WHERE started_at >= $1::timestamptz
        AND started_at <  ($1::timestamptz + interval '1 hour')
        AND status = 'completed'
    ),
    upserted AS (
      INSERT INTO canonical_throughput_hourly
        (hour_start, n_tup_ins, n_tup_upd, n_live_tup, live_count, ing_runs, ing_inserted, ing_updated, source, recorded_at)
      SELECT $1::timestamptz,
             stats.n_tup_ins, stats.n_tup_upd, stats.n_live_tup,
             live.live_count, ing.runs, ing.sum_inserted, ing.sum_updated, $2::text, now()
      FROM stats, live, ing
      ON CONFLICT (hour_start) DO UPDATE SET
        n_tup_ins = EXCLUDED.n_tup_ins,
        n_tup_upd = EXCLUDED.n_tup_upd,
        n_live_tup = EXCLUDED.n_live_tup,
        live_count = COALESCE(EXCLUDED.live_count, canonical_throughput_hourly.live_count),
        ing_runs = EXCLUDED.ing_runs,
        ing_inserted = EXCLUDED.ing_inserted,
        ing_updated = EXCLUDED.ing_updated,
        source = EXCLUDED.source,
        recorded_at = now()
      RETURNING *
    )
    SELECT * FROM upserted
  `, [sqlTimestamp(hourStart), SOURCE_V6]);

  if (!result.rows[0]) throw new Error('Snapshot upsert returned no row.');
  return result.rows[0];
}

async function computeDeltas(client, hourStart, target = TARGET_INSERTS_PER_HOUR) {
  const result = await client.query(`
    WITH cur AS (
      SELECT * FROM canonical_throughput_hourly WHERE hour_start = $1::timestamptz
    ),
    prv AS (
      SELECT * FROM canonical_throughput_hourly WHERE hour_start = ($1::timestamptz - interval '1 hour')
    ),
    computed AS (
      SELECT
        cur.hour_start,
        cur.n_tup_ins,
        cur.n_tup_upd,
        cur.n_live_tup,
        cur.live_count,
        cur.ing_runs,
        cur.ing_inserted,
        cur.ing_updated,
        CASE
          WHEN prv.n_tup_ins IS NULL OR cur.n_tup_ins IS NULL OR cur.n_tup_ins < prv.n_tup_ins THEN NULL
          ELSE cur.n_tup_ins - prv.n_tup_ins
        END AS delta_ins_from_stats,
        CASE
          WHEN prv.n_tup_upd IS NULL OR cur.n_tup_upd IS NULL OR cur.n_tup_upd < prv.n_tup_upd THEN NULL
          ELSE cur.n_tup_upd - prv.n_tup_upd
        END AS delta_upd_from_stats,
        CASE
          WHEN prv.n_tup_ins IS NULL OR cur.n_tup_ins IS NULL THEN true
          WHEN cur.n_tup_ins < prv.n_tup_ins THEN true
          ELSE false
        END AS stat_reset_detected,
        CASE
          WHEN prv.live_count IS NULL OR cur.live_count IS NULL THEN NULL
          ELSE cur.live_count - prv.live_count
        END AS live_count_delta,
        CASE
          WHEN prv.n_live_tup IS NULL OR cur.n_live_tup IS NULL THEN NULL
          ELSE cur.n_live_tup - prv.n_live_tup
        END AS n_live_tup_delta
      FROM cur
      LEFT JOIN prv ON true
    ),
    flagged AS (
      SELECT
        computed.*,
        (
          computed.delta_ins_from_stats IS NOT NULL
          AND computed.delta_ins_from_stats >= $2::bigint
          AND computed.ing_inserted IS NOT NULL
          AND computed.ing_inserted < $2::bigint
        ) AS stats_mismatch_detected,
        CASE
          WHEN computed.delta_ins_from_stats IS NOT NULL
            AND computed.delta_ins_from_stats >= $2::bigint
            AND computed.ing_inserted IS NOT NULL
            AND computed.ing_inserted < $2::bigint
          THEN format(
            'ingestion_runs.ing_inserted %s < target %s while delta_ins_from_stats %s >= target',
            computed.ing_inserted,
            $2::bigint,
            computed.delta_ins_from_stats
          )
          ELSE NULL
        END AS stats_mismatch_reason
      FROM computed
    ),
    updated AS (
      UPDATE canonical_throughput_hourly c
      SET delta_ins_from_stats = flagged.delta_ins_from_stats,
          delta_upd_from_stats = flagged.delta_upd_from_stats,
          stat_reset_detected = flagged.stat_reset_detected,
          stats_mismatch_detected = flagged.stats_mismatch_detected,
          stats_mismatch_reason = flagged.stats_mismatch_reason,
          delta_computed_at = now()
      FROM flagged
      WHERE c.hour_start = flagged.hour_start
      RETURNING c.*
    )
    SELECT flagged.* FROM flagged
  `, [sqlTimestamp(hourStart), target]);

  if (!result.rows[0]) throw new Error(`No canonical row found for ${hourStart.toISOString()}.`);
  return result.rows[0];
}

async function recordDecision(client, hourStart, decision) {
  await client.query(`
    UPDATE canonical_throughput_hourly
    SET last_check_result = $2,
        last_check_reason = $3,
        source = $4
    WHERE hour_start = $1::timestamptz
  `, [sqlTimestamp(hourStart), decision.verdict, decision.reason, SOURCE_V6]);
}

function buildReport(metrics, decision, target = TARGET_INSERTS_PER_HOUR) {
  const hour = new Date(metrics.hour_start).toISOString().slice(0, 13).replace(/[-:]/g, '').replace('T', 'T');
  return `# HOURLY THROUGHPUT REPORT — ${hour}Z (v6.4)\n\n` +
    `- Verdict: **${decision.verdict}**\n` +
    `- Target: ${formatNumber(target)} inserts/hour\n` +
    `- Decision source: ${decision.source}\n` +
    `- Decision reason: ${decision.reason}\n` +
    `- delta_ins_from_stats: ${formatNumber(metrics.delta_ins_from_stats)} (${formatPercent(metrics.delta_ins_from_stats, target)})\n` +
    `- n_live_tup_delta: ${formatNumber(metrics.n_live_tup_delta)}\n` +
    `- live_count_delta: ${formatNumber(metrics.live_count_delta)}\n` +
    `- ingestion_runs.ing_inserted: ${formatNumber(metrics.ing_inserted)} (observability only unless delta_ins_from_stats is NULL)\n` +
    `- stats_mismatch_detected: ${Boolean(metrics.stats_mismatch_detected)}${metrics.stats_mismatch_reason ? ` — ${metrics.stats_mismatch_reason}` : ''}\n` +
    `- stat_reset_detected: ${Boolean(metrics.stat_reset_detected)}\n` +
    `- cycle_marker_inserted: ${formatNumber(metrics.cycle_marker_inserted)} (${formatPercent(metrics.cycle_marker_inserted, target)})\n` +
    `- cycle_marker_cycles: ${formatNumber(metrics.cycle_marker_cycles)}\n`;
}

async function run(options = {}) {
  const hourStart = options.hourStart || completedHour();
  const target = options.target || TARGET_INSERTS_PER_HOUR;
  const client = options.client || buildClient();
  const ownsClient = !options.client;

  try {
    if (ownsClient) await client.connect();
    await client.query(`SET statement_timeout = ${Number(process.env.PG_STATEMENT_TIMEOUT_MS || DEFAULT_STATEMENT_TIMEOUT_MS)}`);
    await ensureCanonicalTable(client);
    await upsertSnapshot(client, hourStart, { skipLiveCount: options.skipLiveCount !== false });
    const metrics = await computeDeltas(client, hourStart, target);
    const cycleMarkers = collectCycleMarkerInserted(hourStart);
    metrics.cycle_marker_inserted = cycleMarkers.inserted;
    metrics.cycle_marker_cycles = cycleMarkers.cycles;
    const decision = select_v6_throughput_signal(metrics, target);
    await recordDecision(client, hourStart, decision);

    // BUY-64988: run source_mix_freshness_check.js to stamp
    // reconciliation_status / reconciliation_gap / reconciliation_reason.
    try {
      const freshnessScript = path.resolve(__dirname, 'source_mix_freshness_check.js');
      const execFileAsync = promisify(execFile);
      const hourISO = hourStart.toISOString();
      const { stdout, stderr } = await execFileAsync(process.execPath, [
        freshnessScript,
        '--hour', hourISO,
        '--write',
        '--json',
      ], {
        // BUY-73337: MAX(created_at) on ~400M rows can take 60-90s under
        // statement_timeout; 30s execFile kill made every tick log
        // [freshness-check:fail] with no FATAL detail.
        timeout: 180_000,
        env: process.env,
      });
      if (stdout && stdout.trim()) {
        const lines = stdout.trim().split('\n');
        console.error('[freshness-check]', lines.slice(0, 5).join('  '));
      }
      if (stderr && stderr.trim()) {
        const errLines = stderr.trim().split('\n');
        console.error('[freshness-check:err]', errLines.slice(0, 3).join('  '));
      }
    } catch (freshnessErr) {
      // Non-blocking guardrail: log but do not fail the dispatcher tick.
      console.error('[freshness-check:fail]', freshnessErr?.message || freshnessErr);
    }

    return {
      hourStart: hourStart.toISOString(),
      target,
      metrics,
      decision,
      shouldFileFailureTicket: should_file_v6_failure_ticket(metrics, target),
      report: buildReport(metrics, decision, target),
    };
  } finally {
    if (ownsClient) await client.end().catch(() => {});
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--hour') {
      options.hourStart = new Date(argv[++index]);
    } else if (arg === '--target') {
      options.target = Number(argv[++index]);
    } else if (arg === '--with-live-count') {
      options.skipLiveCount = false;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--self-test') {
      options.selfTest = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: CANONICAL_DATABASE_URL=... node scripts/dispatcher_v6_hourly.js [--hour ISO] [--json] [--with-live-count]\n\nRuns the BUY-29861 v6.4 hourly throughput dispatcher for the just-completed UTC hour.\nBy default it skips count(*) live_count because v6.4 uses n_live_tup_delta as the no-scan stale-counter guard.`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function selfTest() {
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 150000, n_live_tup_delta: 0 }), false, 'target pass');
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 149999, n_live_tup_delta: 150000 }), false, 'n_live_tup guard pass');
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 150000, ing_inserted: 149999 }), false, 'delta_ins_from_stats hard guard pass');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: 150000, ing_inserted: 149999 }).source, 'delta_ins_from_stats', 'delta_ins_from_stats remains authoritative');
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 149999, n_live_tup_delta: 149999 }), true, 'genuine fail');
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 30000, ing_runs: 0, ing_inserted: 0 }), false, 'drain-only guard suppresses false FAIL');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: 30000, ing_runs: 0, ing_inserted: 0 }).source, 'drain_only_guard', 'drain-only guard source');
  // BUY-69897 (2026-08-23): ing_runs=0 alone must not PASS large-below-target deltas
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 98915, ing_runs: 0, ing_inserted: 0 }), true, 'BUY-69897 ing_runs=0 cannot override large low delta');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: 98915, ing_runs: 0, ing_inserted: 0 }).source, 'delta_ins_from_stats', 'BUY-69897 large low delta falls to delta_ins_from_stats FAIL');
  // still a suppressed drain-only hour below the 50K noise floor
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 4571, ing_runs: 0, ing_inserted: 0 }), false, 'drain-only hour below noise floor still suppressed');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: 4571, ing_runs: 0, ing_inserted: 0 }).source, 'drain_only_guard', 'below-floor hour keeps drain_only_guard PASS');
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 59976, ing_runs: 9, ing_inserted: 438 }), true, 'producer-active low hour remains genuine fail');
  // v6.4: n_live_tup_delta_guard must be blocked when ing_inserted corroborates a real miss
  // (autovacuum bloat release produced huge n_live_tup_delta but only 18 rows actually inserted).
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 0, n_live_tup_delta: 7400000, ing_inserted: 18 }), true, 'v6.4 bloat guard blocks false PASS');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: 0, n_live_tup_delta: 7400000, ing_inserted: 18 }).source, 'delta_ins_from_stats', 'v6.4 bloat guard falls through to delta_ins_from_stats');
  // v6.4 still fires when ing_inserted unavailable (stale-counter protection retained)
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 0, n_live_tup_delta: 200000, ing_inserted: null }), false, 'v6.4 guard still fires when ing_inserted unavailable');
  // v6.4 still fires when ing_inserted >= target (stale-counter protection)
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 0, n_live_tup_delta: 200000, ing_inserted: 200000 }), false, 'v6.4 guard still fires when ing_inserted >= target');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: null, stat_reset_detected: true, live_count_delta: 200000 }).source, 'live_count_delta_fallback', 'live count fallback');
  // v6.4.1: frozen stats counters (n_tup_ins and n_live_tup both unchanged from prior hour)
  // should fall through to ing_inserted_fallback, not produce a false FAIL
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 0, n_live_tup_delta: 0, ing_inserted: 300000 }), false, 'v6.4.1 frozen counter with healthy ing_inserted');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: 0, n_live_tup_delta: 0, ing_inserted: 300000 }).source, 'ing_inserted_fallback', 'v6.4.1 frozen counter uses ing_inserted_fallback');
  // v6.4.1: frozen counters with low ing_inserted is still a real FAIL
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 0, n_live_tup_delta: 0, ing_inserted: 100 }), true, 'v6.4.1 frozen counter with low ing_inserted fails');
  // v6.4.1: delta_ins_from_stats=0 with nonzero n_live_tup_delta is NOT frozen (partial stats)
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 0, n_live_tup_delta: 50000, ing_inserted: 100 }), true, 'v6.4.1 partial stats still fails');
  // BUY-66134: stat_reset_detected + low ingestion_runs + high cycle_marker = PASS
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: null, stat_reset_detected: true, ing_inserted: 57401, cycle_marker_inserted: 398920 }).verdict, 'PASS', 'BUY-66134 cycle_marker_fallback passes');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: null, stat_reset_detected: true, ing_inserted: 57401, cycle_marker_inserted: 398920 }).source, 'cycle_marker_fallback', 'BUY-66134 source is cycle_marker_fallback');
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: null, stat_reset_detected: true, ing_inserted: 57401, cycle_marker_inserted: 398920 }), false, 'BUY-66134 should not file failure');
  // Cycle marker below target with low ingestion_runs still fails
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: null, stat_reset_detected: true, ing_inserted: 10000, cycle_marker_inserted: 10000 }), true, 'low cycle_marker + low ingestion still fails');
  // Frozen counters + high cycle_marker = PASS
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: 0, n_live_tup_delta: 0, ing_inserted: 100, cycle_marker_inserted: 200000 }).source, 'cycle_marker_fallback', 'frozen counters with high cycle_marker uses fallback');
  console.log('dispatcher_v6_hourly self-test: 23 passed');
}

if (require.main === module) {
  (async () => {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }
    if (options.selfTest) {
      selfTest();
      return;
    }
    const result = await run(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.report);
      console.log(`should_file_failure_ticket=${result.shouldFileFailureTicket}`);
    }
  })().catch((error) => {
    console.error('FATAL:', error?.message || error);
    if (error?.stack) console.error(error.stack);
    process.exit(2);
  });
}

module.exports = {
  TARGET_INSERTS_PER_HOUR,
  completedHour,
  select_v6_throughput_signal,
  should_file_v6_failure_ticket,
  buildReport,
  run,
};
