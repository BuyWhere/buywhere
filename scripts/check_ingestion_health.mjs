#!/usr/bin/env node
/**
 * check_ingestion_health.mjs — BUY-31745
 *
 * Calls /v1/ingest/health and prints a human-readable pipeline health report.
 * Exits 0 on healthy/idle, 1 on degraded, 2 on error/down.
 *
 * Required env vars:
 *   BUYWHERE_API_KEY   — API key for auth
 *   API_BASE_URL       — override base URL (default: https://api.buywhere.ai)
 *
 * Usage:
 *   node scripts/check_ingestion_health.mjs
 *   BUYWHERE_API_KEY=bw_xxx node scripts/check_ingestion_health.mjs
 */

import { createRequire } from 'module';

const API_BASE = process.env.API_BASE_URL || 'https://api.buywhere.ai';
const API_KEY  = process.env.BUYWHERE_API_KEY;

if (!API_KEY) {
  console.error('[health] BUYWHERE_API_KEY not set');
  process.exit(2);
}

async function fetchHealth() {
  const url = `${API_BASE}/v1/ingest/health`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      // X-Internal-Monitoring bypasses bot-UA filter (BUY-31745)
      'X-Internal-Monitoring': 'true',
      'User-Agent': 'buywhere-health-monitor/1.0',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

function formatAge(isoTs) {
  if (!isoTs) return 'never';
  const ageMs = Date.now() - new Date(isoTs).getTime();
  const mins  = Math.floor(ageMs / 60_000);
  if (mins < 60)  return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function main() {
  const t0 = Date.now();
  let data;
  try {
    data = await fetchHealth();
  } catch (err) {
    console.error(`[health] CRITICAL: cannot reach ${API_BASE}/v1/ingest/health — ${err.message}`);
    process.exit(2);
  }

  const latencyMs = Date.now() - t0;
  const { status, redis, sources, recent_products_24h, zombie_runs, ts } = data;

  console.log(`\n=== BuyWhere Ingestion Pipeline Health ===`);
  console.log(`  Status   : ${status.toUpperCase()}   (latency ${latencyMs}ms)`);
  console.log(`  Redis    : ${redis}`);
  console.log(`  Products updated 24h: ${recent_products_24h ?? 'n/a'}`);
  console.log(`  Zombie runs (>1h)   : ${zombie_runs ?? 0}`);
  console.log(`  Checked at: ${ts}`);
  console.log();

  if (sources && sources.length > 0) {
    console.log('  Per-source (last 24 h):');
    for (const s of sources) {
      const successAge = formatAge(s.last_success);
      const failAge    = s.last_failure ? formatAge(s.last_failure) : '-';
      console.log(`    ${s.source.padEnd(30)} ok=${s.success_count_24h}  fail=${s.failure_count_24h}  last_ok=${successAge}  last_fail=${failAge}`);
    }
    console.log();
  } else {
    console.log('  No ingestion runs in the last 24 hours.');
    console.log();
  }

  const exitCode = status === 'error'    ? 2
                 : status === 'degraded' ? 1
                 : 0;

  if (exitCode === 0) {
    console.log('  [OK] Pipeline healthy.');
  } else if (exitCode === 1) {
    console.log('  [WARN] Pipeline degraded — check zombie runs or failure rate.');
  } else {
    console.log('  [ERROR] Pipeline error — see above.');
  }

  process.exit(exitCode);
}

main();
