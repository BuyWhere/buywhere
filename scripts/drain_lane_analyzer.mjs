#!/usr/bin/env node
'use strict';

/**
 * BUY-70996 — Drain lane insert/update ratio analyzer.
 *
 * Queries the catalog DB for per-lane insert vs update ratios over the
 * last N hours and produces a rotation recommendation.
 *
 * Reads:   data/drain_lane_config.json  (rotation config)
 * Writes:  data/reports/drain_lane_analysis_{timestamp}.json
 *          data/.drain_lane_recommendations.json  (latest, consumed by rotator)
 *
 * Usage:
 *   DATABASE_URL=... node scripts/drain_lane_analyzer.mjs [--hours 6] [--json]
 *
 * Env:
 *   DATABASE_URL   Required. Connection string for the catalog DB.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'drain_lane_config.json');
const REPORT_DIR = path.join(ROOT, 'data', 'reports');
const RECOMMENDATIONS_PATH = path.join(ROOT, 'data', '.drain_lane_recommendations.json');

const DEFAULT_HOURS = 6;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;

function assertCatalogDsn(raw) {
  let host = '';
  try { host = new URL(raw.replace(/^postgres(ql)?:\/\//, 'https://')).hostname; } catch {}
  if (/roundhouse/i.test(raw) || /roundhouse/i.test(host)) {
    throw new Error('Refusing control-plane DSN (roundhouse). Use catalog DB (sakura).');
  }
}

function buildClient() {
  const raw = process.env.CATALOG_DATABASE_URL || process.env.CANONICAL_DATABASE_URL || process.env.BUYWHERE_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error('Set CATALOG_DATABASE_URL / CANONICAL_DATABASE_URL / BUYWHERE_DATABASE_URL.');
  assertCatalogDsn(raw);
  return new Client({
    connectionString: raw,
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || DEFAULT_CONNECTION_TIMEOUT_MS),
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || DEFAULT_STATEMENT_TIMEOUT_MS),
  });
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`[analyzer] Config not found at ${CONFIG_PATH}, using defaults`);
    return { lanes: {}, rotation_rules: {}, target_insert_share_pct: 70, minimum_insert_share_pct: 40 };
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

function parseArgs(argv) {
  let hours = DEFAULT_HOURS;
  let json = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--hours') hours = parseInt(argv[++i], 10) || DEFAULT_HOURS;
    else if (argv[i] === '--json') json = true;
  }
  return { hours, json };
}

async function getLaneRatios(client, hoursBack) {
  const result = await client.query(`
    WITH lane_stats AS (
      SELECT
        source,
        SUM(COALESCE(rows_inserted, 0)) AS total_inserted,
        SUM(COALESCE(rows_updated, 0)) AS total_updated,
        COUNT(*) AS run_count,
        MAX(started_at) AS last_run,
        MIN(started_at) AS first_run
      FROM ingestion_runs
      WHERE started_at >= NOW() - ($1::text || ' hours')::interval
        AND status IN ('completed', 'completed_with_issues')
      GROUP BY source
    )
    SELECT
      source,
      total_inserted,
      total_updated,
      run_count,
      CASE
        WHEN (total_inserted + total_updated) = 0 THEN NULL
        ELSE ROUND((total_inserted::numeric / (total_inserted + total_updated)) * 100, 1)
      END AS insert_share_pct,
      last_run,
      first_run
    FROM lane_stats
    ORDER BY total_inserted DESC
  `, [String(hoursBack)]);
  return result.rows;
}

async function getProductCountsBySource(client, hoursBack) {
  // Avoid full-table products GROUP BY (statement_timeout / cancel).
  try {
    const result = await client.query(`
      SELECT
        source,
        COUNT(*) FILTER (WHERE created_at >= NOW() - ($1::text || ' hours')::interval) AS recent_inserts,
        COUNT(*) FILTER (WHERE updated_at >= NOW() - ($1::text || ' hours')::interval
                          AND created_at < NOW() - ($1::text || ' hours')::interval) AS recent_updates_only,
        0::bigint AS total_products
      FROM products
      WHERE source IS NOT NULL
        AND (created_at >= NOW() - ($1::text || ' hours')::interval
          OR updated_at >= NOW() - ($1::text || ' hours')::interval)
      GROUP BY source
      ORDER BY recent_inserts DESC
      LIMIT 30
    `, [String(hoursBack)]);
    return result.rows;
  } catch (err) {
    console.error('[analyzer] product counts skipped:', String(err.message).split('\n')[0]);
    return [];
  }
}

function buildRecommendations(config, laneRatios, productCounts) {
  const lanes = config.lanes || {};
  const rules = config.rotation_rules || {};
  const targetInsertShare = config.target_insert_share_pct || 70;
  const minInsertShare = config.minimum_insert_share_pct || 40;

  // Compute overall insert share from ingestion_runs
  let totalInserted = 0;
  let totalUpdated = 0;
  for (const row of laneRatios) {
    totalInserted += Number(row.total_inserted) || 0;
    totalUpdated += Number(row.total_updated) || 0;
  }
  const overallInsertShare = (totalInserted + totalUpdated) > 0
    ? Math.round((totalInserted / (totalInserted + totalUpdated)) * 100 * 10) / 10
    : null;

  // Determine rotation mode
  let mode;
  if (overallInsertShare === null || overallInsertShare >= targetInsertShare) {
    mode = 'healthy';
  } else if (overallInsertShare < minInsertShare) {
    mode = 'boost_discovery';
  } else {
    mode = 'transition';
  }

  // Build per-lane recommendations
  const laneRecommendations = [];
  for (const [laneId, laneConfig] of Object.entries(lanes)) {
    const ratio = laneRatios.find(r => r.source === laneConfig.source_filter);
    const productCount = productCounts.find(p => p.source === laneConfig.source_filter);
    const laneInsertShare = ratio ? Number(ratio.insert_share_pct) : null;

    let recommendedBudgetPct;
    let action;

    if (laneConfig.category === 'discovery') {
      if (mode === 'boost_discovery') {
        recommendedBudgetPct = laneConfig.max_budget_pct;
        action = 'BOOST — discovery lane at max budget';
      } else if (mode === 'healthy') {
        recommendedBudgetPct = laneConfig.default_budget_pct;
        action = 'DEFAULT — healthy insert share';
      } else {
        recommendedBudgetPct = Math.round((laneConfig.default_budget_pct + laneConfig.max_budget_pct) / 2);
        action = 'ELEVATED — transition mode, partial boost';
      }
    } else {
      // re_crawl category
      if (mode === 'boost_discovery') {
        recommendedBudgetPct = laneConfig.min_budget_pct;
        action = 'SHRINK — discovery needed, re-crawl at minimum';
      } else if (mode === 'healthy') {
        recommendedBudgetPct = laneConfig.default_budget_pct;
        action = 'DEFAULT — healthy insert share';
      } else {
        recommendedBudgetPct = Math.round((laneConfig.default_budget_pct + laneConfig.min_budget_pct) / 2);
        action = 'REDUCED — transition mode, partial shrink';
      }
    }

    laneRecommendations.push({
      lane_id: laneId,
      category: laneConfig.category,
      priority: laneConfig.priority,
      source_filter: laneConfig.source_filter,
      current_insert_share_pct: laneInsertShare,
      run_count: ratio ? Number(ratio.run_count) : 0,
      total_inserted: ratio ? Number(ratio.total_inserted) : 0,
      total_updated: ratio ? Number(ratio.total_updated) : 0,
      total_products: productCount ? Number(productCount.total_products) : 0,
      recent_inserts: productCount ? Number(productCount.recent_inserts) : 0,
      recent_updates_only: productCount ? Number(productCount.recent_updates_only) : 0,
      default_budget_pct: laneConfig.default_budget_pct,
      recommended_budget_pct: recommendedBudgetPct,
      action,
    });
  }

  return {
    analyzed_at: new Date().toISOString(),
    hours_back: null, // filled by caller
    overall_insert_share_pct: overallInsertShare,
    total_inserted: totalInserted,
    total_updated: totalUpdated,
    mode,
    target_insert_share_pct: targetInsertShare,
    minimum_insert_share_pct: minInsertShare,
    lanes: laneRecommendations,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const config = loadConfig();
  const client = buildClient();

  try {
    await client.connect();
    const [laneRatios, productCounts] = await Promise.all([
      getLaneRatios(client, opts.hours),
      getProductCountsBySource(client, opts.hours),
    ]);

    const recommendations = buildRecommendations(config, laneRatios, productCounts);
    recommendations.hours_back = opts.hours;

    // Write latest recommendations
    mkdirSync(path.dirname(RECOMMENDATIONS_PATH), { recursive: true });
    writeFileSync(RECOMMENDATIONS_PATH, JSON.stringify(recommendations, null, 2));

    // Write timestamped report
    mkdirSync(REPORT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const reportPath = path.join(REPORT_DIR, `drain_lane_analysis_${ts}.json`);
    writeFileSync(reportPath, JSON.stringify(recommendations, null, 2));

    if (opts.json) {
      console.log(JSON.stringify(recommendations));
    } else {
      console.log(`# Drain Lane Analysis — ${recommendations.analyzed_at}`);
      console.log(`# Mode: ${recommendations.mode}`);
      console.log(`# Overall insert share: ${recommendations.overall_insert_share_pct}% (target: ${recommendations.target_insert_share_pct}%)`);
      console.log(`# Total: ${recommendations.total_inserted.toLocaleString()} inserts, ${recommendations.total_updated.toLocaleString()} updates`);
      console.log('');
      for (const lane of recommendations.lanes) {
        console.log(`  ${lane.lane_id}: insert_share=${lane.current_insert_share_pct ?? 'n/a'}% budget=${lane.recommended_budget_pct}% [${lane.action}]`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err?.message || err);
  process.exit(2);
});
