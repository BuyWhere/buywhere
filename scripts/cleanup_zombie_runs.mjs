#!/usr/bin/env node
/**
 * cleanup_zombie_runs.mjs — Identify and mark zombie ingestion runs as 'failed'.
 *
 * Finds runs stuck in 'running' for >1 hour and sets them to 'failed' with a
 * descriptive error message.
 *
 * Required env vars:
 *   DATABASE_URL — PostgreSQL connection string
 */

import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    // Find zombie runs
    const { rows: zombies } = await client.query(
      `SELECT id, source, started_at, EXTRACT(EPOCH FROM (NOW() - started_at)) AS stuck_seconds
       FROM ingestion_runs
       WHERE status = 'running' AND started_at < NOW() - INTERVAL '1 hour'
       ORDER BY started_at ASC`
    );

    if (zombies.length === 0) {
      console.log('[cleanup] No zombie runs found.');
      return;
    }

    console.log(`[cleanup] Found ${zombies.length} zombie run(s):`);
    for (const z of zombies) {
      const stuckMin = Math.round(z.stuck_seconds / 60);
      console.log(`  - ${z.id}  source=${z.source}  started=${z.started_at}  stuck=${stuckMin}m`);
    }

    // Mark them as failed
    const result = await client.query(
      `UPDATE ingestion_runs
       SET status = 'failed',
           error = 'Auto-cleaned: stuck in running state for >1 hour (zombie run)',
           completed_at = NOW()
       WHERE status = 'running' AND started_at < NOW() - INTERVAL '1 hour'`
    );

    console.log(`\n[cleanup] Updated ${result.rowCount} zombie run(s) to 'failed'.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[cleanup] ERROR:', err.message);
  process.exit(1);
});
