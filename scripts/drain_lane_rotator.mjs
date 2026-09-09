#!/usr/bin/env node
'use strict';

/**
 * BUY-70996 — Drain lane rotation scheduler.
 *
 * Reads the latest drain lane analysis recommendations and adjusts
 * worker budgets accordingly. Produces a lane budget manifest that
 * keepalive scripts consume to set --duration-sec and priority ordering.
 *
 * Writes:  data/.drain_lane_budgets.json  (consumed by keepalive scripts)
 *          data/reports/drain_lane_rotation_{timestamp}.json
 *
 * Usage:
 *   node scripts/drain_lane_rotator.mjs [--json] [--dry-run]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RECOMMENDATIONS_PATH = path.join(ROOT, 'data', '.drain_lane_recommendations.json');
const BUDGETS_PATH = path.join(ROOT, 'data', '.drain_lane_budgets.json');
const REPORT_DIR = path.join(ROOT, 'data', 'reports');
const CONFIG_PATH = path.join(ROOT, 'data', 'drain_lane_config.json');

// Total drain time budget per hour in seconds (45 min of a 60-min hour for draining)
const TOTAL_DRAIN_BUDGET_SEC = 45 * 60;
const COOLDOWN_SEC = 30 * 60;

function parseArgs(argv) {
  let json = false;
  let dryRun = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--json') json = true;
    if (argv[i] === '--dry-run') dryRun = true;
  }
  return { json, dryRun };
}

function loadRecommendations() {
  if (!existsSync(RECOMMENDATIONS_PATH)) {
    console.error('[rotator] No recommendations found. Run drain_lane_analyzer.mjs first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(RECOMMENDATIONS_PATH, 'utf8'));
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { lanes: {} };
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

function buildBudgets(recommendations, config) {
  const totalPct = recommendations.lanes.reduce((sum, l) => sum + l.recommended_budget_pct, 0);
  const lanes = [];
  let assignedSec = 0;

  // Sort lanes by priority (lower = higher priority), then by recommended budget
  const sorted = [...recommendations.lanes].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.recommended_budget_pct - a.recommended_budget_pct;
  });

  for (let i = 0; i < sorted.length; i++) {
    const lane = sorted[i];
    const budgetPctOfTotal = totalPct > 0 ? lane.recommended_budget_pct / totalPct : 0;
    const budgetSec = Math.round(TOTAL_DRAIN_BUDGET_SEC * budgetPctOfTotal);

    // Ensure minimum 30 seconds per lane
    const finalBudget = Math.max(30, budgetSec);

    lanes.push({
      lane_id: lane.lane_id,
      category: lane.category,
      priority: lane.priority,
      source_filter: lane.source_filter,
      current_insert_share_pct: lane.current_insert_share_pct,
      recommended_budget_pct: lane.recommended_budget_pct,
      budget_seconds: finalBudget,
      budget_minutes: Math.round(finalBudget / 60 * 10) / 10,
      action: lane.action,
      rotation_order: i + 1,
    });
    assignedSec += finalBudget;
  }

  return {
    generated_at: new Date().toISOString(),
    mode: recommendations.mode,
    overall_insert_share_pct: recommendations.overall_insert_share_pct,
    target_insert_share_pct: recommendations.target_insert_share_pct,
    total_drain_budget_sec: TOTAL_DRAIN_BUDGET_SEC,
    total_assigned_sec: assignedSec,
    cooldown_sec: COOLDOWN_SEC,
    lanes,
  };
}

function applyBudgetsToKeepaliveScripts(budgets) {
  // Update the keepalive state files to reflect new budget priorities
  const updates = [];

  for (const lane of budgets.lanes) {
    // Write per-lane budget metadata that keepalive scripts can read
    const budgetFile = path.join(ROOT, 'data', `.drain_lane_budget_${lane.lane_id}.json`);
    const metadata = {
      lane_id: lane.lane_id,
      budget_seconds: lane.budget_seconds,
      rotation_order: lane.rotation_order,
      action: lane.action,
      updated_at: budgets.generated_at,
    };
    writeFileSync(budgetFile, JSON.stringify(metadata, null, 2));
    updates.push({ lane_id: lane.lane_id, budget_seconds: lane.budget_seconds });
  }

  return updates;
}

function main() {
  const opts = parseArgs(process.argv);
  const recommendations = loadRecommendations();
  const config = loadConfig();
  const budgets = buildBudgets(recommendations, config);

  // Report
  if (opts.json) {
    console.log(JSON.stringify(budgets, null, 2));
  } else {
    console.log(`# Drain Lane Rotation — ${budgets.generated_at}`);
    console.log(`# Mode: ${budgets.mode} | Insert share: ${budgets.overall_insert_share_pct}% (target: ${budgets.target_insert_share_pct}%)`);
    console.log(`# Total budget: ${budgets.total_drain_budget_sec}s | Assigned: ${budgets.total_assigned_sec}s`);
    console.log('');
    for (const lane of budgets.lanes) {
      const catLabel = lane.category === 'discovery' ? '🔍' : '🔄';
      console.log(`  ${catLabel} #${lane.rotation_order} ${lane.lane_id.padEnd(25)} ${String(lane.budget_minutes).padStart(5)}min  insert_share=${lane.current_insert_share_pct ?? 'n/a'}%  [${lane.action}]`);
    }
  }

  // Write budgets
  if (!opts.dryRun) {
    mkdirSync(path.dirname(BUDGETS_PATH), { recursive: true });
    writeFileSync(BUDGETS_PATH, JSON.stringify(budgets, null, 2));

    // Apply to per-lane files
    const updates = applyBudgetsToKeepaliveScripts(budgets);

    // Write timestamped report
    mkdirSync(REPORT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const reportPath = path.join(REPORT_DIR, `drain_lane_rotation_${ts}.json`);
    writeFileSync(reportPath, JSON.stringify({ budgets, updates }, null, 2));

    if (!opts.json) {
      console.log(`\nBudgets written to ${BUDGETS_PATH}`);
      console.log(`Report: ${reportPath}`);
    }
  } else {
    if (!opts.json) console.log('\n[dry-run] No files written');
  }
}

main();
