#!/usr/bin/env node
/**
 * BUY-72215 — Catalog DB stale session killer.
 *
 * Finds sessions stuck in 'active' or 'idle in transaction' for >15 minutes,
 * cancels them (pg_cancel_backend), waits 60s, then terminates survivors
 * (pg_terminate_backend). Logs every action to:
 *   data/buy30620-stale-kills.log          (append, human-readable)
 *   data/reports/buy72215-stale-kills-YYYY-MM-DD.jsonl  (structured, per-day)
 *
 * Connects via data/.catalog_db_url (buywhere_ingest role, has cancel perms).
 * Rate-limit: rely on shell wrapper using flock(1) — this script does NOT lock.
 * Safe to invoke every 5 minutes from cron.
 *
 * Usage: node scripts/buy72215-stale-session-killer.mjs [--dry-run]
 */

import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// ── Config ──────────────────────────────────────────────────────────────────
const STALE_THRESHOLD_MIN = parseInt(process.env.STALE_THRESHOLD_MIN || '15', 10);
const CANCEL_WAIT_SEC     = 60;
const DRY_RUN             = process.argv.includes('--dry-run');

// ── Helpers ─────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (!DRY_RUN) {
    try {
      const logDir = join(PROJECT_ROOT, 'data');
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
      appendFileSync(join(logDir, 'buy30620-stale-kills.log'), line + '\n');
    } catch { /* best-effort */ }
  }
}

function writeJsonl(obj) {
  if (DRY_RUN) { console.log(JSON.stringify(obj)); return; }
  try {
    const dir = join(PROJECT_ROOT, 'data', 'reports');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const d = new Date().toISOString().slice(0, 10);
    appendFileSync(join(dir, `buy72215-stale-kills-${d}.jsonl`), JSON.stringify(obj) + '\n');
  } catch { /* */ }
}

function readDbUrl() {
  const candidates = [
    join(PROJECT_ROOT, 'data', '.catalog_db_url'),
    '/home/paperclip/buywhere/data/.catalog_db_url',
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const url = readFileSync(p, 'utf8').trim();
        if (url && url.startsWith('postgresql')) return url;
      }
    } catch { /* continue */ }
  }
  throw new Error('Cannot find data/.catalog_db_url — no valid catalog DB URL');
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const catalogUrl = readDbUrl();
  log(`Connecting to catalog DB...${DRY_RUN ? ' [DRY RUN]' : ''}`);

  const pool = new Pool({
    connectionString: catalogUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'buy72215-stale-killer',
  });

  const client = await pool.connect();
  try {
    // 1. Find stale sessions
    //    Exclude: own session (pid != pg_backend_pid()), connection-owning
    //    pgboss workers (they use application_name='pgboss'), and replication /
    //    autovacuum / background backends that never have a user query_start.
    const { rows: stale } = await client.query(`
      SELECT pid, usename, application_name, state, query_start,
             EXTRACT(EPOCH FROM (NOW() - query_start))::int AS age_sec,
             LEFT(query, 200) AS query_preview
      FROM pg_stat_activity
      WHERE pid != pg_backend_pid()
        AND (state = 'active' OR state = 'idle in transaction')
      AND query_start IS NOT NULL
      AND query_start < NOW() - make_interval(mins => $1)
      AND COALESCE(application_name, '') NOT ILIKE '%pgboss%'
      AND COALESCE(application_name, '') NOT ILIKE '%walreceiver%'
      AND COALESCE(application_name, '') NOT ILIKE '%logical%'
      AND COALESCE(application_name, '') NOT ILIKE '%autovacuum%'
      AND backend_type NOT IN ('autovacuum worker', 'background worker', 'logical replication launcher', 'logical replication worker', 'walreceiver', 'walsender')
      ORDER BY query_start ASC
    `, [STALE_THRESHOLD_MIN]);

    if (stale.length === 0) {
      log('No stale sessions detected.');
      return;
    }

    log(`Found ${stale.length} stale session(s) (threshold ${STALE_THRESHOLD_MIN}m):`);
    for (const s of stale) {
      const ageMin = Math.round(s.age_sec / 60);
      log(`  pid=${s.pid} user=${s.usename} state=${s.state} age=${ageMin}m app=${s.application_name} query=${s.query_preview}`);
      writeJsonl({
        ts: new Date().toISOString(), event: 'detected',
        pid: s.pid, usename: s.usename, application_name: s.application_name,
        state: s.state, age_sec: s.age_sec, query_preview: s.query_preview,
      });
    }

    if (DRY_RUN) {
      log(`[DRY RUN] Would cancel ${stale.length} session(s). Exiting.`);
      return;
    }

    // 2. Cancel all stale sessions (soft kill)
    const cancelled = [];
    for (const s of stale) {
      try {
        await client.query('SELECT pg_cancel_backend($1)', [s.pid]);
        cancelled.push(s);
        log(`  cancelled pid=${s.pid}`);
        writeJsonl({ ts: new Date().toISOString(), event: 'cancelled', pid: s.pid });
      } catch (err) {
        log(`  cancel FAILED pid=${s.pid}: ${err.message}`);
        writeJsonl({ ts: new Date().toISOString(), event: 'cancel_failed', pid: s.pid, error: err.message });
      }
    }

    // 3. Wait for cancellations to take effect
    log(`Waiting ${CANCEL_WAIT_SEC}s for cancellations to propagate...`);
    await new Promise(r => setTimeout(r, CANCEL_WAIT_SEC * 1000));

    // 4. Check which sessions survived cancellation
    const survivorPids = cancelled.map(s => s.pid);
    if (survivorPids.length === 0) return;

    const { rows: survivors } = await client.query(`
      SELECT pid, state, EXTRACT(EPOCH FROM (NOW() - query_start))::int AS age_sec
      FROM pg_stat_activity
      WHERE pid = ANY($1)
        AND (state = 'active' OR state = 'idle in transaction')
    `, [survivorPids]);

    if (survivors.length === 0) {
      log('All cancelled sessions terminated cleanly.');
      return;
    }

    // 5. Terminate survivors (hard kill)
    for (const s of survivors) {
      try {
        await client.query('SELECT pg_terminate_backend($1)', [s.pid]);
        log(`  TERMINATED pid=${s.pid} (survived cancel, age=${s.age_sec}s)`);
        writeJsonl({ ts: new Date().toISOString(), event: 'terminated', pid: s.pid, age_sec: s.age_sec });
      } catch (err) {
        log(`  terminate FAILED pid=${s.pid}: ${err.message}`);
        writeJsonl({ ts: new Date().toISOString(), event: 'terminate_failed', pid: s.pid, error: err.message });
      }
    }

    log(`Done — ${cancelled.length} cancelled, ${survivors.length} terminated.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
