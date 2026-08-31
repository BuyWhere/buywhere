#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

let Client;

function loadPgClient() {
  if (Client) return Client;
  try {
    ({ Client } = require('pg'));
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    ({ Client } = require(path.join(__dirname, '..', 'api', 'node_modules', 'pg')));
  }
  return Client;
}

const TARGET_INSERTS_PER_HOUR = 150_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const ROUNDHOUSE_HOST = 'roundhouse.proxy.rlwy.net';
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

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function isDrainOnlyHour(metrics) {
  return metrics?.non_drain_runs === 0 || metrics?.drain_only_hour === true;
}

function select_v6_throughput_signal(metrics, target = TARGET_INSERTS_PER_HOUR) {
  const deltaInsFromStats = toNumber(metrics?.delta_ins_from_stats);
  const ingInsertedRaw = toNumber(metrics?.ing_inserted);
  const ingInserted = ingInsertedRaw ?? 0;
  const liveCountDelta = toNumber(metrics?.live_count_delta);
  const nLiveTupDelta = toNumber(metrics?.n_live_tup_delta);
  const statResetDetected = Boolean(metrics?.stat_reset_detected);
  const nonDrainMedian = toNumber(metrics?.trailing_non_drain_median);
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

  if (deltaInsFromStats === null || statResetDetected) {
    // v6 fallback #1: ingestion_runs is used only when pg_stat counters reset
    // or the dispatcher is on its first tick and the authoritative delta is NULL.
    if (ingInsertedRaw !== null && ingInsertedRaw >= target) {
      return {
        verdict: 'PASS',
        value: ingInserted,
        source: 'ing_inserted_fallback',
        reason: `stat reset/unavailable insert delta; ingestion_runs.ing_inserted ${formatNumber(ingInserted)} >= ${formatNumber(target)}`
      };
    }

    // v6 fallback #2: live_count_delta is considered only after both pg_stat and
    // ingestion_runs are unavailable or below target.
    if (liveCountDelta !== null && liveCountDelta >= target) {
      return {
        verdict: 'PASS',
        value: liveCountDelta,
        source: 'live_count_delta_fallback',
        reason: `stat reset/unavailable insert delta and ingestion_runs below/unavailable; live_count_delta ${formatNumber(liveCountDelta)} >= ${formatNumber(target)}`
      };
    }

    return {
      verdict: 'FAIL',
      value: ingInserted,
      source: 'ing_inserted_fallback',
      reason: `stat reset/unavailable insert delta; ingestion_runs.ing_inserted ${formatNumber(ingInserted)} < ${formatNumber(target)}, live_count_delta ${formatNumber(liveCountDelta)} < ${formatNumber(target)}`
    };
  }

  // BUY-72265: drain-only hours should not file false-positive FAILs.
  // If the hour had zero non-drain runs and the 7-day trailing median of
  // producer-active hours is below target, the producer lane was simply quiet.
  if (isDrainOnlyHour(metrics) && nonDrainMedian !== null && nonDrainMedian < target) {
    return {
      verdict: 'PRODUCER_QUIET',
      value: deltaInsFromStats,
      source: 'producer_quiet',
      reason: `drain-only hour; 7-day non-drain median ${formatNumber(nonDrainMedian)} < ${formatNumber(target)} (delta_ins_from_stats ${formatNumber(deltaInsFromStats)})`,
    };
  }

  return {
    verdict: 'FAIL',
    value: deltaInsFromStats,
    source: 'delta_ins_from_stats',
    reason: `delta_ins_from_stats ${formatNumber(deltaInsFromStats)} < ${formatNumber(target)} and no v6 guard met target`,
  };
}


function assert_v6_forbidden_patterns(metrics, decision, target = TARGET_INSERTS_PER_HOUR) {
  const deltaInsFromStats = toNumber(metrics?.delta_ins_from_stats);
  const liveCountDelta = toNumber(metrics?.live_count_delta);
  const ingInsertedRaw = toNumber(metrics?.ing_inserted);

  // PRODUCER_QUIET is a recognized exempted verdict, not a failure.
  if (decision.verdict === 'PRODUCER_QUIET') return;

  if (decision.verdict === 'FAIL' && deltaInsFromStats !== null && decision.source !== 'delta_ins_from_stats') {
    throw new Error('v6 forbidden pattern 5c/6.1: FAILURE cannot be based on ingestion_runs or secondary metrics when delta_ins_from_stats is non-null');
  }

  if (decision.verdict === 'FAIL' && deltaInsFromStats !== null && deltaInsFromStats >= target) {
    throw new Error('v6 forbidden pattern 5b/6.4: FAILURE with delta_ins_from_stats >= target is forbidden');
  }

  if (decision.verdict === 'FAIL' && deltaInsFromStats !== null && liveCountDelta === 0 && deltaInsFromStats !== 0) {
    throw new Error('v6 forbidden pattern 6.2: live_count_delta=0 cannot override non-zero delta_ins_from_stats');
  }

  if (decision.verdict === 'FAIL' && deltaInsFromStats === 0 && liveCountDelta !== null && liveCountDelta >= target) {
    throw new Error('v6 forbidden pattern 6.2: delta_ins_from_stats=0 cannot override passing live_count_delta when stats fallback is active');
  }

  if (decision.verdict === 'FAIL' && deltaInsFromStats !== null && ingInsertedRaw === 0 && decision.source === 'ing_inserted_fallback') {
    throw new Error('v6 forbidden pattern 5c/6.1: never file FAILURE based on ingestion_runs.ing_inserted=0 alone');
  }
}

function should_file_v6_failure_ticket(metrics, target = TARGET_INSERTS_PER_HOUR) {
  const decision = select_v6_throughput_signal(metrics, target);
  assert_v6_forbidden_patterns(metrics, decision, target);
  // PRODUCER_QUIET exempts the hour from filing a FAIL child issue (BUY-72265).
  return decision.verdict === 'FAIL';
}

function buildConnectionString() {
  const raw = process.env.CANONICAL_DATABASE_URL || process.env.MAGLEV_DB_URL || process.env.DATABASE_URL || process.env.BUYWHERE_DATABASE_URL;
  if (!raw) {
    throw new Error('Set CANONICAL_DATABASE_URL, MAGLEV_DB_URL, DATABASE_URL, or BUYWHERE_DATABASE_URL for the canonical DB.');
  }
  const hostname = new URL(raw).hostname;
  if (hostname === ROUNDHOUSE_HOST) {
    throw new Error(`Refusing canonical DB connection to control-plane host ${ROUNDHOUSE_HOST}`);
  }
  return raw;
}

function buildClient() {
  const PgClient = loadPgClient();
  return new PgClient({
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
      ['drain_only_hour', 'boolean DEFAULT false'],
      ['non_drain_runs', 'integer DEFAULT 0'],
      ['trailing_non_drain_median', 'bigint'],
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
          THEN (SELECT COALESCE(SUM(s.n_tup_ins), 0) FROM pg_stat_all_tables s WHERE s.relid IN (SELECT relid FROM children) AND s.schemaname = 'public')
          ELSE (SELECT COALESCE(n_tup_ins, 0) FROM pg_stat_all_tables WHERE relname = 'products' AND schemaname = 'public')
        END AS n_tup_ins,
        CASE WHEN EXISTS (SELECT 1 FROM children)
          THEN (SELECT COALESCE(SUM(s.n_tup_upd), 0) FROM pg_stat_all_tables s WHERE s.relid IN (SELECT relid FROM children) AND s.schemaname = 'public')
          ELSE (SELECT COALESCE(n_tup_upd, 0) FROM pg_stat_all_tables WHERE relname = 'products' AND schemaname = 'public')
        END AS n_tup_upd,
        CASE WHEN EXISTS (SELECT 1 FROM children)
          THEN (SELECT COALESCE(SUM(s.n_live_tup), 0) FROM pg_stat_all_tables s WHERE s.relid IN (SELECT relid FROM children) AND s.schemaname = 'public')
          ELSE (SELECT COALESCE(n_live_tup, 0) FROM pg_stat_all_tables WHERE relname = 'products' AND schemaname = 'public')
        END AS n_live_tup
    ),
    live AS (${liveCountSql}),
    ing AS (
      SELECT
        count(*)::int AS runs,
        COALESCE(sum(rows_inserted), 0)::bigint AS sum_inserted,
        COALESCE(sum(rows_updated), 0)::bigint AS sum_updated,
        COALESCE(count(*) FILTER (WHERE source NOT LIKE 'ingest:ops-drain-svc:%'), 0)::int AS non_drain_runs
      FROM ingestion_runs
      WHERE started_at >= $1::timestamptz
        AND started_at <  ($1::timestamptz + interval '1 hour')
        AND status = 'completed'
    ),
    upserted AS (
      INSERT INTO canonical_throughput_hourly
        (hour_start, n_tup_ins, n_tup_upd, n_live_tup, live_count, ing_runs, ing_inserted, ing_updated, non_drain_runs, source, recorded_at)
      SELECT $1::timestamptz,
             stats.n_tup_ins, stats.n_tup_upd, stats.n_live_tup,
             live.live_count, ing.runs, ing.sum_inserted, ing.sum_updated, ing.non_drain_runs, $2::text, now()
      FROM stats, live, ing
      ON CONFLICT (hour_start) DO UPDATE SET
        n_tup_ins = EXCLUDED.n_tup_ins,
        n_tup_upd = EXCLUDED.n_tup_upd,
        n_live_tup = EXCLUDED.n_live_tup,
        live_count = COALESCE(EXCLUDED.live_count, canonical_throughput_hourly.live_count),
        ing_runs = EXCLUDED.ing_runs,
        ing_inserted = EXCLUDED.ing_inserted,
        ing_updated = EXCLUDED.ing_updated,
        non_drain_runs = EXCLUDED.non_drain_runs,
        source = EXCLUDED.source,
        recorded_at = now()
      WHERE canonical_throughput_hourly.delta_computed_at IS NULL
      RETURNING *
    ),
    selected AS (
      SELECT * FROM upserted
      UNION ALL
      SELECT *
      FROM canonical_throughput_hourly
      WHERE hour_start = $1::timestamptz
        AND NOT EXISTS (SELECT 1 FROM upserted)
    )
    SELECT * FROM selected
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
        cur.non_drain_runs,
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
          delta_computed_at = now(),
          drain_only_hour = (flagged.non_drain_runs = 0)
      FROM flagged
      WHERE c.hour_start = flagged.hour_start
        AND c.delta_computed_at IS NULL
      RETURNING c.*
    )
    SELECT flagged.* FROM flagged
  `, [sqlTimestamp(hourStart), target]);

  if (!result.rows[0]) throw new Error(`No canonical row found for ${hourStart.toISOString()}.`);
  return result.rows[0];
}

async function fetchTrailingNonDrainMedian(client, hourStart, lookbackDays = 7) {
  const result = await client.query(`
    SELECT COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY delta_ins_from_stats), NULL)::bigint AS median_delta
    FROM canonical_throughput_hourly
    WHERE hour_start >= $1::timestamptz - ($2 || ' days')::interval
      AND hour_start < $1::timestamptz
      AND non_drain_runs > 0
      AND delta_ins_from_stats IS NOT NULL
  `, [sqlTimestamp(hourStart), lookbackDays.toString()]);
  return toNumber(result.rows[0]?.median_delta);
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
    `- non_drain_runs: ${formatNumber(metrics.non_drain_runs)}\n` +
    `- drain_only_hour: ${Boolean(metrics.drain_only_hour)}\n` +
    `- trailing_non_drain_median: ${formatNumber(metrics.trailing_non_drain_median)}\n` +
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
    metrics.trailing_non_drain_median = await fetchTrailingNonDrainMedian(client, hourStart);
    const cycleMarkers = collectCycleMarkerInserted(hourStart);
    metrics.cycle_marker_inserted = cycleMarkers.inserted;
    metrics.cycle_marker_cycles = cycleMarkers.cycles;
    const decision = select_v6_throughput_signal(metrics, target);
    assert_v6_forbidden_patterns(metrics, decision, target);
    await recordDecision(client, hourStart, decision);

    // BUY-64988: run source_mix_freshness_check.js to stamp
    // reconciliation_status / reconciliation_gap / reconciliation_reason.
    try {
      const freshnessScript = path.resolve(__dirname, 'source_mix_freshness_check.js');
      if (!fs.existsSync(freshnessScript)) {
        console.error('[freshness-check:skip] source_mix_freshness_check.js not present');
      } else {
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
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 30000, ing_runs: 0, ing_inserted: 0 }), true, 'v6 non-null low delta remains authoritative FAIL');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: 30000, ing_runs: 0, ing_inserted: 0 }).source, 'delta_ins_from_stats', 'v6 rejects drain-only PASS override');
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 98915, ing_runs: 0, ing_inserted: 0 }), true, 'ing_runs=0 cannot override large low delta');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: 98915, ing_runs: 0, ing_inserted: 0 }).source, 'delta_ins_from_stats', 'large low delta falls to delta_ins_from_stats FAIL');
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 4571, ing_runs: 0, ing_inserted: 0 }), true, 'small non-null low delta also fails under canonical v6');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: 4571, ing_runs: 0, ing_inserted: 0 }).source, 'delta_ins_from_stats', 'small low delta source remains delta_ins_from_stats');
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
  // canonical v6: delta_ins_from_stats=0 is non-null and remains authoritative.
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 0, n_live_tup_delta: 0, ing_inserted: 300000 }), true, 'canonical v6 frozen-looking zero stats remains FAIL');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: 0, n_live_tup_delta: 0, ing_inserted: 300000 }).source, 'delta_ins_from_stats', 'canonical v6 zero stats source remains delta_ins_from_stats');
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 0, n_live_tup_delta: 0, ing_inserted: 100 }), true, 'zero stats with low ing_inserted fails');
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 0, n_live_tup_delta: 50000, ing_inserted: 100 }), true, 'partial stats still fails');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: null, stat_reset_detected: true, ing_inserted: 200000 }).source, 'ing_inserted_fallback', 'stat reset uses ingestion_runs fallback first');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: null, stat_reset_detected: true, ing_inserted: 57401, live_count_delta: 398920 }).source, 'live_count_delta_fallback', 'stat reset uses live count after low ingestion_runs');
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: null, stat_reset_detected: true, ing_inserted: 57401, live_count_delta: 398920 }), false, 'high live_count fallback should not file failure');
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: null, stat_reset_detected: true, ing_inserted: 10000, live_count_delta: 10000 }), true, 'low ingestion + low live count fails');
  // BUY-72265: drain-only hours are exempted from FAIL when the producer median is low.
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 70000, non_drain_runs: 0, trailing_non_drain_median: 90000 }), false, 'drain-only + low producer median exempt');
  assertEqual(select_v6_throughput_signal({ delta_ins_from_stats: 70000, non_drain_runs: 0, trailing_non_drain_median: 90000 }).verdict, 'PRODUCER_QUIET', 'PRODUCER_QUIET verdict');
  // Drain-only hour with a healthy producer median still files FAIL (median can't verify quiet).
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 70000, non_drain_runs: 0, trailing_non_drain_median: 200000 }), true, 'drain-only + high producer median still fails');
  // A producer-active low hour still files FAIL.
  assertEqual(should_file_v6_failure_ticket({ delta_ins_from_stats: 70000, non_drain_runs: 3, trailing_non_drain_median: 90000 }), true, 'producer-active low hour fails');
  console.log('dispatcher_v6_hourly self-test: 26 passed');
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
  assert_v6_forbidden_patterns,
  buildReport,
  run,
  median,
  isDrainOnlyHour,
  fetchTrailingNonDrainMedian,
};
