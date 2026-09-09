#!/usr/bin/env node
'use strict';

/**
 * BUY-70996 — Drain lane rotation scheduler.
 *
 * Chains drain_lane_analyzer.mjs → drain_lane_rotator.mjs in a single
 * invocation. The analyzer queries the catalog DB for per-lane insert/update
 * ratios and produces recommendations. The rotator reads those
 * recommendations and writes per-lane budget files consumed by keepalive
 * scripts to set DURATION_SEC.
 *
 * Writes:
 *   data/.drain_lane_recommendations.json  (analyzer output)
 *   data/.drain_lane_budgets.json          (rotator output — aggregate)
 *   data/.drain_lane_budget_{lane_id}.json (per-lane budget for keepalive)
 *   data/reports/drain_lane_analysis_{ts}.json
 *   data/reports/drain_lane_rotation_{ts}.json
 *   data/reports/drain_lane_scheduler.log  (append-only log)
 *
 * Usage:
 *   DATABASE_URL=... node scripts/drain_lane_scheduler.mjs [--hours 6] [--dry-run] [--json]
 *
 * Env:
 *   DATABASE_URL   Required. Connection string for the catalog DB.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ANALYZER = path.join(__dirname, 'drain_lane_analyzer.mjs');
const ROTATOR = path.join(__dirname, 'drain_lane_rotator.mjs');
const RECOMMENDATIONS_PATH = path.join(ROOT, 'data', '.drain_lane_recommendations.json');
const BUDGETS_PATH = path.join(ROOT, 'data', '.drain_lane_budgets.json');
const LOG_PATH = path.join(ROOT, 'data', 'reports', 'drain_lane_scheduler.log');

function parseArgs(argv) {
  let hours = 6;
  let dryRun = false;
  let json = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--hours') hours = parseInt(argv[++i], 10) || 6;
    else if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--json') json = true;
  }
  return { hours, dryRun, json };
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    writeFileSync(LOG_PATH, line + '\n', { flag: 'a' });
  } catch {}
}

function runNode(script, args) {
  const allArgs = [script, ...args];
  return execFileSync(process.execPath, allArgs, {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    timeout: 120_000,
  });
}

async function main() {
  const opts = parseArgs(process.argv);

  log(`scheduler: starting rotation cycle (hours=${opts.hours}, dry_run=${opts.dryRun})`);

  // ── Step 1: Run analyzer ──
  log('scheduler: running drain_lane_analyzer...');
  const analyzerArgs = ['--hours', String(opts.hours), '--json'];
  if (opts.dryRun) analyzerArgs.push('--dry-run');
  let analyzerOutput;
  try {
    analyzerOutput = runNode(ANALYZER, analyzerArgs);
  } catch (err) {
    console.error(`scheduler: analyzer failed: ${err?.message || err}`);
    process.exit(2);
  }

  let recommendations;
  try {
    recommendations = JSON.parse(analyzerOutput);
  } catch {
    // Analyzer may have printed human-readable; try reading the file
    if (existsSync(RECOMMENDATIONS_PATH)) {
      recommendations = JSON.parse(readFileSync(RECOMMENDATIONS_PATH, 'utf8'));
    } else {
      console.error('scheduler: could not parse analyzer output or recommendations file');
      process.exit(2);
    }
  }

  log(`scheduler: analysis mode=${recommendations.mode} insert_share=${recommendations.overall_insert_share_pct}%`);

  // ── Step 2: Run rotator ──
  log('scheduler: running drain_lane_rotator...');
  const rotatorArgs = ['--json'];
  if (opts.dryRun) rotatorArgs.push('--dry-run');
  let rotatorOutput;
  try {
    rotatorOutput = runNode(ROTATOR, rotatorArgs);
  } catch (err) {
    console.error(`scheduler: rotator failed: ${err?.message || err}`);
    process.exit(3);
  }

  let budgets;
  try {
    budgets = JSON.parse(rotatorOutput);
  } catch {
    if (existsSync(BUDGETS_PATH)) {
      budgets = JSON.parse(readFileSync(BUDGETS_PATH, 'utf8'));
    } else {
      console.error('scheduler: could not parse rotator output or budgets file');
      process.exit(3);
    }
  }

  // ── Step 3: Summary ──
  const laneSummary = budgets.lanes.map(l => ({
    lane_id: l.lane_id,
    category: l.category,
    budget_seconds: l.budget_seconds,
    budget_minutes: l.budget_minutes,
    action: l.action,
    rotation_order: l.rotation_order,
  }));

  const summary = {
    scheduled_at: new Date().toISOString(),
    mode: budgets.mode,
    overall_insert_share_pct: budgets.overall_insert_share_pct,
    target_insert_share_pct: budgets.target_insert_share_pct,
    total_drain_budget_sec: budgets.total_drain_budget_sec,
    lanes: laneSummary,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const lane of laneSummary) {
      const icon = lane.category === 'discovery' ? '🔍' : '🔄';
      log(`scheduler: ${icon} #${lane.rotation_order} ${lane.lane_id.padEnd(25)} ${String(lane.budget_minutes).padStart(5)}min  [${lane.action}]`);
    }
  }

  log('scheduler: rotation cycle complete');
}

main().catch(err => {
  console.error('FATAL:', err?.message || err);
  process.exit(1);
});
