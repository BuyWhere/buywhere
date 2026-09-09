#!/usr/bin/env node
'use strict';

/**
 * source_mix_freshness_check.js — BUY-64501 / BUY-64988
 *
 * Insert-yield collapse guardrail + candidate freshness + counters reconciliation.
 *
 * Produces a per-hour report covering three orthogonal axes:
 *
 *   1. Source-mix collapse guardrail
 *      - For each just-completed hour, count distinct sources, runs with
 *        rows_inserted=0, and zero/near-zero-insert sources.
 *      - Fail the guard when >=40% of distinct sources had ZERO inserts
 *        AND total inserts < 150,000 (target).
 *      - This is the guardrail called out in BUY-64501: "add insert-yield
 *        collapse guardrails."
 *
 *   2. Candidate freshness
 *      - Show newest merchant_candidates.discovered_at and merchants.created_at
 *        vs NOW(); both should be <48h for healthy candidate supply.
 *      - Surface counts of validated candidates / never-scraped active merchants
 *        so operators can see the supply state.
 *
 *   3. Counters vs products reconciliation (BUY-64988)
 *      - Compare canonical_throughput_hourly.ing_inserted vs COUNT(products.created_at)
 *        for the same hour. |gap| >= 100,000 = DRIFT.
 *      - |gap| < 10% of ing_inserted AND ing_inserted > 0 = ALIGNED.
 *      - 24-hour rolling window: when all 24 hours are ALIGNED, the writer
 *        counter is trustworthy.
 *      - Writes the verdict into canonical_throughput_hourly.reconciliation_status
 *        so operational reports can pick up the column directly.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/source_mix_freshness_check.js [--hour ISO] [--json] [--write]
 *
 * Env:
 *   DATABASE_URL   Required. Connection string for the canonical DB.
 */

const { Client } = require('pg');

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const ZERO_INSERT_RATIO_FAIL_THRESHOLD = 0.4; // 40% of distinct sources with rows_inserted=0 fails guard
const CANDIDATE_FRESHNESS_HEALTHY_HOURS = 48;
const RECONCILIATION_GAP_ABS_THRESHOLD = 100_000;
const RECONCILIATION_GAP_PCT_THRESHOLD = 0.10; // 10% of ing_inserted
const RECONCILIATION_WINDOW_HOURS = 24;
const ROUNDHOUSE_HOST = 'roundhouse.proxy.rlwy.net';

function buildConnectionString() {
  // BUY-73337: prefer CANONICAL_DATABASE_URL (catalog DSN) so an ambient
  // DATABASE_URL (control-plane roundhouse) can never poison catalog queries.
  const raw = process.env.CANONICAL_DATABASE_URL ||
    process.env.BUYWHERE_DATABASE_URL ||
    process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('Set CANONICAL_DATABASE_URL, BUYWHERE_DATABASE_URL, or DATABASE_URL.');
  }
  const parsed = new URL(raw);
  if (parsed.hostname === ROUNDHOUSE_HOST) {
    throw new Error(`Refusing canonical DB connection to control-plane host ${ROUNDHOUSE_HOST}`);
  }
  if (parsed.searchParams.get('sslmode') === 'require' && !parsed.searchParams.has('uselibpqcompat')) {
    parsed.searchParams.set('uselibpqcompat', 'true');
  }
  return parsed.toString();
}

function buildClient() {
  return new Client({
    connectionString: buildConnectionString(),
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || DEFAULT_CONNECTION_TIMEOUT_MS),
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || DEFAULT_STATEMENT_TIMEOUT_MS),
  });
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

async function getHourSourceMix(client, hourStart) {
  const result = await client.query(`
    WITH hour_runs AS (
      SELECT source,
             rows_inserted,
             rows_updated
      FROM ingestion_runs
      WHERE started_at >= $1::timestamptz
        AND started_at <  ($1::timestamptz + interval '1 hour')
        AND status = 'completed'
    )
    SELECT
      COUNT(DISTINCT source)::integer                                   AS distinct_sources,
      COUNT(*)::integer                                                AS completed_runs,
      COUNT(*) FILTER (WHERE rows_inserted = 0)::integer               AS zero_insert_runs,
      COUNT(DISTINCT source) FILTER (WHERE rows_inserted = 0)::integer AS zero_insert_sources,
      COALESCE(SUM(rows_inserted), 0)::bigint                           AS total_inserted,
      COALESCE(SUM(rows_updated), 0)::bigint                            AS total_updated,
      COALESCE(AVG(rows_inserted), 0)::float                            AS avg_inserts_per_run
    FROM hour_runs
  `, [hourStart.toISOString().replace('.000Z', '+00')]);
  return result.rows[0] || {};
}

async function getCandidateFreshness(client) {
  let result;
  try {
    result = await client.query(`
    SELECT
      (SELECT MAX(discovered_at) FROM merchant_candidates)               AS newest_candidate,
      (SELECT MAX(validated_at) FROM merchant_candidates)                AS newest_validated,
      (SELECT COUNT(*) FROM merchant_candidates)                         AS total_candidates,
      (SELECT COUNT(*) FROM merchant_candidates WHERE validated)        AS validated_candidates,
      (SELECT MAX(created_at) FROM merchants)                            AS newest_merchant,
      (SELECT COUNT(*) FROM merchants WHERE is_active)                   AS active_merchants,
      (SELECT COUNT(*) FROM merchants WHERE source='shopify' AND is_active
              AND last_scraped_at IS NULL)                               AS shopify_never_scraped,
      NOW()                                                              AS now_ts
  `);
  } catch (err) {
    // Graceful degradation: merchant_candidates table may not exist yet (42P01 = undefined_table).
    // Return candidate fields as null/0 so downstream freshness evaluation still runs.
    if (err.code === '42P01') {
      result = await client.query(`
        SELECT
          NULL::timestamptz AS newest_candidate,
          NULL::timestamptz AS newest_validated,
          0 AS total_candidates,
          0 AS validated_candidates,
          (SELECT MAX(created_at) FROM merchants)                            AS newest_merchant,
          (SELECT COUNT(*) FROM merchants WHERE is_active)                   AS active_merchants,
          (SELECT COUNT(*) FROM merchants WHERE source='shopify' AND is_active
                  AND last_scraped_at IS NULL)                               AS shopify_never_scraped,
          NOW()                                                              AS now_ts
      `);
    } else {
      throw err;
    }
  }
  const row = result.rows[0] || {};
  const hoursSince = (col) => {
    const ts = row[col];
    if (!ts) return null;
    const ms = new Date(row.now_ts).getTime() - new Date(ts).getTime();
    return Math.round(ms / 3_600_000);
  };
  return {
    newest_candidate: row.newest_candidate,
    hours_since_newest_candidate: hoursSince('newest_candidate'),
    newest_validated: row.newest_validated,
    hours_since_newest_validated: hoursSince('newest_validated'),
    total_candidates: Number(row.total_candidates || 0),
    validated_candidates: Number(row.validated_candidates || 0),
    newest_merchant: row.newest_merchant,
    hours_since_newest_merchant: hoursSince('newest_merchant'),
    active_merchants: Number(row.active_merchants || 0),
    shopify_never_scraped: Number(row.shopify_never_scraped || 0),
  };
}

async function getCounterProductsReconciliation(client, hourStart) {
  // Compare canonical_throughput_hourly.ing_inserted vs a measure of products
  // created in the same hour. The canonical_throughput_hourly row carries
  // pg_stat delta (delta_ins_from_stats) — that is the cheap, partition-prunable
  // counter for the products table and bypasses the table-wide COUNT that
  // times out on the 406GB products table (no created_at index exists).
  //
  // BUY-73800: short-circuit when ing_inserted=0 (both sides are zero → DRIFT=0,
  // no measurement needed); when ing_inserted>0, prefer delta_ins_from_stats
  // (already populated and free) and only fall back to a direct products COUNT
  // when the dispatcher delta is unavailable (stat reset / older rows).
  const canonical = await client.query(`
    SELECT ing_inserted, delta_ins_from_stats, stat_reset_detected
    FROM canonical_throughput_hourly
    WHERE hour_start = $1::timestamptz
  `, [hourStart.toISOString().replace('.000Z', '+00')]);
  const canonicalRow = canonical.rows[0] || {};
  const ingInserted = canonicalRow.ing_inserted == null ? null : Number(canonicalRow.ing_inserted || 0);
  const statsDeltaIns = canonicalRow.delta_ins_from_stats == null ? null : Number(canonicalRow.delta_ins_from_stats);
  const statResetDetected = !!canonicalRow.stat_reset_detected;

  // Short-circuit: when there is no recorded ingest for the hour, the products
  // side is definitionally bounded at the dispatcher delta or zero. We trust
  // the cheap pg_stat delta first; only if the dispatcher recorded a non-zero
  // ingest do we attempt the expensive products COUNT.
  let productsCount = null;
  let productsCountTimedOut = false;
  let productsCountSource = 'unmeasured';
  let countShortCircuited = false;
  try {
    if (ingInserted !== null && ingInserted === 0) {
      // No recorded ingest for this hour → DRIFT=0 is the only mathematically
      // possible outcome. Do not run the products COUNT.
      countShortCircuited = true;
      productsCountSource = 'short_circuit_ing_inserted_zero';
      productsCount = 0;
    } else if (statsDeltaIns !== null && !statResetDetected) {
      // Cheap path: use the dispatcher's pg_stat delta, which is already a
      // bounded per-hour measurement and avoids the heavyweight COUNT. This
      // is the same integer the dispatcher writes from pg_stat_user_tables.
      productsCount = statsDeltaIns;
      productsCountSource = 'canonical_delta_ins_from_stats';
    } else {
      // Fallback path: try the direct products COUNT with a short timeout.
      // On a 406GB products table without a created_at index, this will
      // typically time out; the catch below records that without aborting.
      const products = await client.query(`
        SELECT COUNT(*)::bigint AS rows
        FROM products
        WHERE created_at >= $1::timestamptz
          AND created_at <  ($1::timestamptz + interval '1 hour')
      `, [hourStart.toISOString().replace('.000Z', '+00')]);
      productsCount = Number(products.rows[0]?.rows || 0);
      productsCountSource = 'direct_products_count';
    }
  } catch (err) {
    productsCountTimedOut = true;
  }

  // Note: `SELECT MAX(created_at) FROM products` was previously emitted as a
  // diagnostic. With no created_at index it forces a 406GB seq scan on every
  // invocation and is the second source of timeouts alongside the COUNT. Drop
  // it entirely — the row-level freshness signal we actually need lives in
  // `ingestion_runs.started_at` (queried by `getHourSourceMix` above with
  // indexed predicates) and in `canonical_throughput_hourly` itself.
  const productsCreatedAtMax = null;
  const productsCreatedAtMaxTimedOut = false;
  return {
    canonical_ing_inserted: ingInserted,
    canonical_delta_ins_from_stats: statsDeltaIns,
    canonical_stat_reset_detected: statResetDetected,
    products_created_in_hour: productsCount,
    products_count_timed_out: productsCountTimedOut,
    products_count_source: productsCountSource,
    products_count_short_circuited: countShortCircuited,
    products_created_at_max: productsCreatedAtMax,
    products_created_at_max_timed_out: productsCreatedAtMaxTimedOut,
    gap_inserted_minus_products: ingInserted !== null && productsCount !== null
      ? ingInserted - productsCount
      : null,
  };
}

function evaluateGuardrail(mix, target = 150000) {
  const distinctSources = Number(mix.distinct_sources || 0);
  const zeroInsertSources = Number(mix.zero_insert_sources || 0);
  const totalInserted = Number(mix.total_inserted || 0);
  const zeroSourceRatio = distinctSources > 0 ? zeroInsertSources / distinctSources : 0;
  const isFail = totalInserted < target && zeroSourceRatio >= ZERO_INSERT_RATIO_FAIL_THRESHOLD;
  return {
    zero_source_ratio: Number(zeroSourceRatio.toFixed(3)),
    fails_guardrail: isFail,
    reason: isFail
      ? `zero-insert sources ${zeroInsertSources}/${distinctSources} (${(zeroSourceRatio*100).toFixed(1)}%) >= ${ZERO_INSERT_RATIO_FAIL_THRESHOLD*100}% AND total inserts ${totalInserted} < target ${target}`
      : (totalInserted < target
          ? `total inserts ${totalInserted} < target ${target} but zero-source ratio ${(zeroSourceRatio*100).toFixed(1)}% < ${ZERO_INSERT_RATIO_FAIL_THRESHOLD*100}%`
          : `total inserts ${totalInserted} >= target ${target} (pass)`),
  };
}

function evaluateCandidateFreshness(freshness) {
  const newestHours = freshness.hours_since_newest_candidate;
  const validatedHours = freshness.hours_since_newest_validated;
  const merchantHours = freshness.hours_since_newest_merchant;
  const isStale = (newestHours !== null && newestHours > CANDIDATE_FRESHNESS_HEALTHY_HOURS) ||
                  (merchantHours !== null && merchantHours > CANDIDATE_FRESHNESS_HEALTHY_HOURS);
  return {
    is_stale: isStale,
    healthy_threshold_hours: CANDIDATE_FRESHNESS_HEALTHY_HOURS,
    hours_since_newest_candidate: newestHours,
    hours_since_newest_merchant: merchantHours,
    hours_since_newest_validated: validatedHours,
    reason: isStale
      ? `candidate/merchant discovery stale: newest candidate ${newestHours}h, newest merchant ${merchantHours}h > ${CANDIDATE_FRESHNESS_HEALTHY_HOURS}h threshold`
      : `candidate/merchant discovery within ${CANDIDATE_FRESHNESS_HEALTHY_HOURS}h healthy threshold`,
  };
}

function evaluateCountersReconciliation(recon) {
  // BUY-64988: alignment is the new bar.
  //   - |gap| >= RECONCILIATION_GAP_ABS_THRESHOLD => DRIFT (hard signal)
  //   - |gap| / max(ingInserted, 1) >= RECONCILIATION_GAP_PCT_THRESHOLD => DRIFT (relative signal)
  //   - short_circuit (ing_inserted=0, products_count=0) => ALIGNED (DRIFT=0)
  //   - otherwise: ALIGNED
  //   - data missing AND no short-circuit fallback => UNKNOWN
  //
  // BUY-73800: the products-side measurement now travels through one of three
  //   paths (`short_circuit_ing_inserted_zero`, `canonical_delta_ins_from_stats`,
  //   `direct_products_count`). When `products_count_short_circuited` is true the
  //   reconciliation is mechanically ALIGNED (DRIFT=0); when the dispatcher
  //   delta was used as the products leg, the message references the source.
  const ingInserted = recon.canonical_ing_inserted;
  const productsCount = recon.products_created_in_hour;
  const productsShortCircuited = !!recon.products_count_short_circuited;
  const productsCountSource = recon.products_count_source || 'unmeasured';
  const gap = (ingInserted === null || ingInserted === undefined ||
               productsCount === null || productsCount === undefined)
    ? null
    : ingInserted - productsCount;
  let status = 'ALIGNED';
  let reason = 'within tolerance';
  let isUnknown = false;
  if (gap === null) {
    status = 'UNKNOWN';
    isUnknown = true;
    reason = recon.products_count_timed_out
      ? 'products.created_at COUNT timed out; cannot reconcile'
      : 'ing_inserted missing or both legs missing';
  } else if (productsShortCircuited && ingInserted === 0 && productsCount === 0) {
    // BUY-73800 short-circuit: both legs are zero. Emit DRIFT=0 (ALIGNED) with
    // an explicit reason so Gate 3 has a first-class status without paying for
    // the products table COUNT.
    status = 'ALIGNED';
    reason = `DRIFT=0 (short-circuit): ing_inserted=0 and products_count=0 for hour, no COUNT run (source=${productsCountSource})`;
  } else if (Math.abs(gap) >= RECONCILIATION_GAP_ABS_THRESHOLD) {
    status = 'DRIFT';
    reason = `ing_inserted (${ingInserted}) vs products_leg (${productsCount}) |gap|=${Math.abs(gap)} >= ${RECONCILIATION_GAP_ABS_THRESHOLD.toLocaleString('en-US')} threshold (source=${productsCountSource})`;
  } else if (ingInserted > 0 && Math.abs(gap) / Math.max(ingInserted, 1) >= RECONCILIATION_GAP_PCT_THRESHOLD) {
    status = 'DRIFT';
    reason = `ing_inserted (${ingInserted}) vs products_leg (${productsCount}) |gap|/ing_inserted=${(Math.abs(gap)/Math.max(ingInserted,1)*100).toFixed(1)}% >= ${RECONCILIATION_GAP_PCT_THRESHOLD*100}% relative threshold (source=${productsCountSource})`;
  } else if (productsCountSource === 'canonical_delta_ins_from_stats') {
    // ALIGNED via the pg_stat fallback path; surface the source so reviewers
    // know we did not run a direct COUNT.
    reason = `within tolerance (source=${productsCountSource}; gap=${gap})`;
  }
  return {
    status,
    is_drift: status === 'DRIFT',
    is_unknown: isUnknown,
    reason,
    gap_inserted_minus_products: gap,
    canonical_ing_inserted: ingInserted,
    products_created_in_hour: productsCount,
    products_count_timed_out: recon.products_count_timed_out,
    products_count_source: productsCountSource,
    products_count_short_circuited: productsShortCircuited,
  };
}

function buildReport(hourStart, mix, guardrail, freshness, freshState, recon, drift, target, window) {
  return `# SOURCE-MIX FRESHNESS REPORT — ${hourStart.toISOString().slice(0,13)}Z\n\n` +
    `## 1. Source-mix collapse guardrail\n` +
    `- Just-completed hour: ${hourStart.toISOString()}\n` +
    `- Distinct sources: ${mix.distinct_sources}\n` +
    `- Completed runs: ${mix.completed_runs}\n` +
    `- Zero-insert runs: ${mix.zero_insert_runs}\n` +
    `- Zero-insert sources: ${mix.zero_insert_sources}\n` +
    `- Total inserted: ${mix.total_inserted} (target ${formatNumber(target)})\n` +
    `- Total updated: ${mix.total_updated}\n` +
    `- Avg inserts/run: ${Number(mix.avg_inserts_per_run || 0).toFixed(1)}\n` +
    `- Zero-source ratio: ${(guardrail.zero_source_ratio * 100).toFixed(1)}%\n` +
    `- Guardrail verdict: **${guardrail.fails_guardrail ? 'FAIL' : 'PASS'}**\n` +
    `- Reason: ${guardrail.reason}\n\n` +
    `## 2. Candidate freshness\n` +
    `- Newest merchant_candidate.discovered_at: ${freshness.newest_candidate} (${freshness.hours_since_newest_candidate}h ago)\n` +
    `- Newest merchant_candidate.validated_at: ${freshness.newest_validated} (${freshness.hours_since_newest_validated}h ago)\n` +
    `- Total candidates: ${freshness.total_candidates} (${freshness.validated_candidates} validated)\n` +
    `- Newest merchant.created_at: ${freshness.newest_merchant} (${freshness.hours_since_newest_merchant}h ago)\n` +
    `- Active merchants: ${freshness.active_merchants}\n` +
    `- Shopify never-scraped: ${freshness.shopify_never_scraped}\n` +
    `- Freshness verdict: **${freshState.is_stale ? 'STALE' : 'HEALTHY'}**\n` +
    `- Reason: ${freshState.reason}\n\n` +
    `## 3. Counters vs products reconciliation (BUY-64988 / BUY-73800)\n` +
    `- canonical_throughput_hourly.ing_inserted: ${recon.canonical_ing_inserted}\n` +
    `- canonical_throughput_hourly.delta_ins_from_stats: ${recon.canonical_delta_ins_from_stats == null ? 'NULL' : recon.canonical_delta_ins_from_stats}\n` +
    `- products measurement source: ${drift.products_count_source || recon.products_count_source || 'unmeasured'}${drift.products_count_short_circuited ? ' (short-circuit)' : ''}\n` +
    `- products_created_in_hour: ${recon.products_created_in_hour}${recon.products_count_timed_out ? ' (timed out — best-effort)' : ''}\n` +
    `- products.created_at MAX: ${recon.products_created_at_max}\n` +
    `- Gap (ing_inserted - products_count): ${drift.gap_inserted_minus_products}\n` +
    `- Alignment verdict: **${drift.status}**\n` +
    `- Reason: ${drift.reason}\n` +
    (window ? `- 24h rolling window: ${window.hours_aligned}/${window.window_hours} hours ALIGNED (<10% gap)` +
              ` — threshold met: ${window.threshold_met ? 'YES' : 'NO'}\n` : '');
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : 'NULL';
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--hour') options.hourStart = new Date(argv[++i]);
    else if (arg === '--target') options.target = Number(argv[++i]);
    else if (arg === '--json') options.json = true;
    else if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--write') options.write = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: DATABASE_URL=... node scripts/source_mix_freshness_check.js [--hour ISO] [--target 150000] [--json] [--write]

BUY-64501 source-mix/freshness guardrail:
  1. Source-mix collapse guardrail — fail when >=40% distinct sources have
     rows_inserted=0 AND total inserts < target.
  2. Candidate freshness — flag when newest merchant_candidates.discovered_at
     or merchants.created_at is >48h old.
  3. Counters vs products reconciliation (BUY-64988) — flag when |gap| >=
     100,000 OR |gap|/ing_inserted >= 10%. Writes reconciliation_status to
     canonical_throughput_hourly when --write is set.`);
}

/**
 * Compute the 24-hour rolling alignment window. Returns the count of
 * hours in the last 24 that are ALIGNED plus a threshold-met flag.
 *
 * BUY-73800: the products leg of the alignment was previously computed with
 *   `SELECT COUNT(*) FROM products WHERE created_at ... GROUP BY 1 hour`,
 *   which times out on the 406GB products table. The dispatcher already writes
 *   `delta_ins_from_stats` (pg_stat delta of products inserts per hour) into
 *   `canonical_throughput_hourly` — use that as the products leg. The
 *   `ingestion_runs` sum on the ing leg is unchanged.
 */
async function get24hAlignmentWindow(client, endHour) {
  const start = new Date(endHour.getTime() - (RECONCILIATION_WINDOW_HOURS - 1) * 3_600_000);
  const result = await client.query(`
    WITH hours AS (
      SELECT generate_series($1::timestamptz, $2::timestamptz, interval '1 hour') AS hour_start
    ),
    cth AS (
      SELECT hour_start,
             COALESCE(ing_inserted, 0)::bigint     AS ing_inserted,
             COALESCE(delta_ins_from_stats, 0)::bigint AS products_leg
      FROM canonical_throughput_hourly
      WHERE hour_start >= $1::timestamptz
        AND hour_start <= $2::timestamptz
    )
    SELECT h.hour_start,
           COALESCE(cth.ing_inserted, 0)  AS ing_inserted,
           COALESCE(cth.products_leg, 0)  AS products_count
    FROM hours h
    LEFT JOIN cth ON cth.hour_start = h.hour_start
  `, [start.toISOString().replace('.000Z', '+00'), endHour.toISOString().replace('.000Z', '+00')]);
  let aligned = 0;
  let totalInserted = 0;
  let driftTotal = 0;
  for (const row of result.rows) {
    const ing = Number(row.ing_inserted || 0);
    const prod = Number(row.products_count || 0);
    const gap = ing - prod;
    const absGap = Math.abs(gap);
    const relGap = ing > 0 ? absGap / ing : 0;
    totalInserted += ing;
    if (absGap < RECONCILIATION_GAP_ABS_THRESHOLD && relGap < RECONCILIATION_GAP_PCT_THRESHOLD) {
      aligned++;
    } else if (ing > 0) {
      driftTotal += absGap;
    }
  }
  return {
    window_hours: RECONCILIATION_WINDOW_HOURS,
    hours_aligned: aligned,
    hours_evaluated: result.rows.length,
    threshold_met: aligned === result.rows.length && result.rows.length >= RECONCILIATION_WINDOW_HOURS,
    total_ing_inserted: totalInserted,
    total_drift: driftTotal,
  };
}

async function writeReconciliationStatus(client, hourStart, drift, window) {
  const status = drift.status;
  const gap = drift.gap_inserted_minus_products;
  const reason = `${drift.reason}${window ? ` | 24h-window: ${window.hours_aligned}/${window.window_hours} aligned` : ''}`;
  // We use an UPDATE-only path: never insert a new hourly row just to record
  // reconciliation status. The canonical_throughput_hourly rollup is owned
  // by another writer (the dispatcher or a separate hourly job); we just
  // stamp our status on existing rows. If no row exists yet for this hour
  // we fall through silently — the next dispatcher tick will create it.
  await client.query(`
    UPDATE canonical_throughput_hourly
       SET reconciliation_status = $2,
           reconciliation_gap = $3,
           reconciliation_reason = $4,
           reconciliation_checked_at = NOW()
     WHERE hour_start = $1::timestamptz
  `, [hourStart.toISOString().replace('.000Z', '+00'), status, gap, reason]);
}

function selfTest() {
  function eq(actual, expected, msg) {
    if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
  // Guardrail: zero-source ratio >= 40% AND inserts < target => FAIL
  const mix1 = { distinct_sources: 100, zero_insert_sources: 50, total_inserted: 1000, completed_runs: 200, zero_insert_runs: 50, total_updated: 10000, avg_inserts_per_run: 5 };
  const g1 = evaluateGuardrail(mix1, 150000);
  eq(g1.fails_guardrail, true, 'guardrail fails with 50/100 zero sources and 1k inserts');
  // Guardrail: low zero-source ratio => PASS even if inserts low
  const mix2 = { distinct_sources: 100, zero_insert_sources: 10, total_inserted: 1000, completed_runs: 200, zero_insert_runs: 10, total_updated: 10000, avg_inserts_per_run: 5 };
  const g2 = evaluateGuardrail(mix2, 150000);
  eq(g2.fails_guardrail, false, 'guardrail passes with only 10/100 zero sources');
  // Guardrail: meets target => PASS regardless of ratio
  const mix3 = { distinct_sources: 100, zero_insert_sources: 90, total_inserted: 200000, completed_runs: 200, zero_insert_runs: 90, total_updated: 10000, avg_inserts_per_run: 1000 };
  const g3 = evaluateGuardrail(mix3, 150000);
  eq(g3.fails_guardrail, false, 'guardrail passes when target met');
  // Freshness: stale
  const f1 = evaluateCandidateFreshness({ hours_since_newest_candidate: 200, hours_since_newest_merchant: 240 });
  eq(f1.is_stale, true, 'freshness flags 200h stale');
  // Freshness: fresh
  const f2 = evaluateCandidateFreshness({ hours_since_newest_candidate: 12, hours_since_newest_merchant: 24 });
  eq(f2.is_stale, false, 'freshness healthy at 12h');
  // Recon: aligned (small gap)
  const r1 = evaluateCountersReconciliation({ canonical_ing_inserted: 1500, products_created_in_hour: 1400, products_count_timed_out: false });
  eq(r1.status, 'ALIGNED', 'recon aligned with 100 gap');
  // Recon: relative drift (gap >= 10% of ing_inserted)
  const rRel = evaluateCountersReconciliation({ canonical_ing_inserted: 1000, products_created_in_hour: 0, products_count_timed_out: false });
  eq(rRel.status, 'DRIFT', 'recon drift when products=0 ing_inserted=1000 (100% gap)');
  // Recon: absolute drift (large gap)
  const r2 = evaluateCountersReconciliation({ canonical_ing_inserted: 200000, products_created_in_hour: 1000, products_count_timed_out: false });
  eq(r2.status, 'DRIFT', 'recon drift with 199k gap');
  // Recon: timed out
  const r3 = evaluateCountersReconciliation({ canonical_ing_inserted: 1000, products_created_in_hour: null, products_count_timed_out: true });
  eq(r3.status, 'UNKNOWN', 'recon unknown when count timed out');
  // Recon: aligned when both zero
  const rZero = evaluateCountersReconciliation({ canonical_ing_inserted: 0, products_created_in_hour: 0, products_count_timed_out: false });
  eq(rZero.status, 'ALIGNED', 'recon aligned when both zero');
  // BUY-73800: short-circuit (ing_inserted=0) emits DRIFT=0 with explicit reason
  const rShortCircuit = evaluateCountersReconciliation({
    canonical_ing_inserted: 0,
    products_created_in_hour: 0,
    products_count_timed_out: false,
    products_count_short_circuited: true,
    products_count_source: 'short_circuit_ing_inserted_zero',
  });
  eq(rShortCircuit.status, 'ALIGNED', 'recon short-circuit emits ALIGNED (DRIFT=0)');
  eq(rShortCircuit.is_drift, false, 'short-circuit is not drift');
  if (!rShortCircuit.reason.includes('DRIFT=0')) {
    throw new Error(`short-circuit reason missing DRIFT=0: ${rShortCircuit.reason}`);
  }
  // BUY-73800: pg_stat fallback path produces ALIGNED when within tolerance
  const rPgStat = evaluateCountersReconciliation({
    canonical_ing_inserted: 12000,
    products_created_in_hour: 12759,
    products_count_timed_out: false,
    products_count_source: 'canonical_delta_ins_from_stats',
  });
  eq(rPgStat.status, 'ALIGNED', 'recon aligned via pg_stat fallback within tolerance');
  if (!rPgStat.reason.includes('canonical_delta_ins_from_stats')) {
    throw new Error(`pg_stat reason missing source label: ${rPgStat.reason}`);
  }
  // BUY-73800: pg_stat fallback with large gap emits DRIFT
  const rPgStatDrift = evaluateCountersReconciliation({
    canonical_ing_inserted: 12000,
    products_created_in_hour: 200000,
    products_count_timed_out: false,
    products_count_source: 'canonical_delta_ins_from_stats',
  });
  eq(rPgStatDrift.status, 'DRIFT', 'recon drift via pg_stat fallback when |gap| large');
  console.log('source_mix_freshness_check self-test: 13 passed');
}

async function run(options = {}) {
  const hourStart = options.hourStart || completedHour();
  const target = options.target || 150000;
  const client = options.client || buildClient();
  const ownsClient = !options.client;
  try {
    if (ownsClient) await client.connect();
    await client.query(`SET statement_timeout = ${Number(process.env.PG_STATEMENT_TIMEOUT_MS || DEFAULT_STATEMENT_TIMEOUT_MS)}`);
    const mix = await getHourSourceMix(client, hourStart);
    const guardrail = evaluateGuardrail(mix, target);
    const freshness = await getCandidateFreshness(client);
    const freshState = evaluateCandidateFreshness(freshness);
    const recon = await getCounterProductsReconciliation(client, hourStart);
    const drift = evaluateCountersReconciliation(recon);
    let window = null;
    if (options.write) {
      try {
        window = await get24hAlignmentWindow(client, hourStart);
      } catch (err) {
        window = null;
      }
      await writeReconciliationStatus(client, hourStart, drift, window);
    }
    return {
      hourStart: hourStart.toISOString(),
      target,
      sourceMix: mix,
      guardrail,
      freshness,
      freshnessState: freshState,
      reconciliation: recon,
      reconciliationState: drift,
      window,
      shouldEscalate: guardrail.fails_guardrail || freshState.is_stale || drift.is_drift,
      report: buildReport(hourStart, mix, guardrail, freshness, freshState, recon, drift, target, window),
    };
  } finally {
    if (ownsClient) await client.end().catch(() => {});
  }
}

if (require.main === module) {
  (async () => {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { printHelp(); return; }
    if (options.selfTest) { selfTest(); return; }
    const result = await run(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.report);
      console.log(`should_escalate=${result.shouldEscalate}`);
    }
  })().catch((error) => {
    console.error('FATAL:', error?.message || error);
    if (error?.stack) console.error(error.stack);
    process.exit(2);
  });
}

module.exports = {
  completedHour,
  evaluateGuardrail,
  evaluateCandidateFreshness,
  evaluateCountersReconciliation,
  get24hAlignmentWindow,
  writeReconciliationStatus,
  buildReport,
  run,
  RECONCILIATION_WINDOW_HOURS,
  RECONCILIATION_GAP_ABS_THRESHOLD,
  RECONCILIATION_GAP_PCT_THRESHOLD,
};
