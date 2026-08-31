/**
 * catalogQualityRunner.ts — Long-running scheduler for the nightly catalog-quality snapshot (BUY-78635)
 *
 * Runs daily at 02:00 UTC. Spawns the Python snapshot script as a child process
 * so the heavy SQL work stays in the Python async engine while the Node.js runner
 * handles scheduling and lifecycle.
 *
 * Override schedule via env vars:
 *   QUALITY_SNAPSHOT_HOUR_UTC  (default: 2)
 *   QUALITY_SNAPSHOT_MIN_UTC   (default: 0)
 *
 * Run manually with `npm run catalog-quality` to execute immediately and exit.
 */

import { execFile } from 'child_process';
import { resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const HOUR_UTC = parseInt(process.env.QUALITY_SNAPSHOT_HOUR_UTC ?? '2', 10);
const MIN_UTC  = parseInt(process.env.QUALITY_SNAPSHOT_MIN_UTC  ?? '0',  10);

// Resolve the Python script relative to the repo root (one level above api/)
const SCRIPT_DIR = resolve(__dirname, '..', '..', 'scripts');
const PYTHON_SCRIPT = resolve(SCRIPT_DIR, 'catalog_quality_snapshot.py');

/** Milliseconds until the next HH:MM UTC window. */
function msUntilNext(hourUtc: number, minUtc: number): number {
  const now  = new Date();
  const next = new Date(now);
  next.setUTCHours(hourUtc, minUtc, 0, 0);
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function formatDelay(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

async function tick(): Promise<void> {
  console.log('[catalog-quality-runner] Job triggered — spawning Python snapshot script');
  const start = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(
      'python3',
      [PYTHON_SCRIPT, '--once'],
      {
        cwd: resolve(__dirname, '..', '..'),
        env: { ...process.env },
        maxBuffer: 10 * 1024 * 1024, // 10MB
      }
    );

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[catalog-quality-runner] Completed in ${elapsed}s`);
    if (stdout?.trim()) {
      const lines = stdout.trim().split('\n').slice(-5);
      lines.forEach((l: string) => console.log(`  ${l}`));
    }
    if (stderr?.trim()) {
      console.error('[catalog-quality-runner] stderr:', stderr.trim().slice(0, 500));
    }
  } catch (err: any) {
    console.error(`[catalog-quality-runner] Script failed: ${err.message}`);
    if (err.stdout?.trim()) {
      console.error('--- stdout ---');
      err.stdout.trim().split('\n').forEach((l: string) => console.error(`  ${l}`));
    }
    if (err.stderr?.trim()) {
      console.error('--- stderr ---');
      err.stderr.trim().split('\n').forEach((l: string) => console.error(`  ${l}`));
    }
    // Don't rethrow — keep the scheduler alive
  }

  schedule();
}

function schedule(): void {
  const delay = msUntilNext(HOUR_UTC, MIN_UTC);
  console.log(
    `[catalog-quality-runner] Next run at ${HOUR_UTC.toString().padStart(2, '0')}:${MIN_UTC.toString().padStart(2, '0')} UTC ` +
    `— in ${formatDelay(delay)}`
  );
  setTimeout(() => { tick().catch((err) => console.error('[catalog-quality-runner] Tick error:', err)); }, delay);
}

async function main(): Promise<void> {
  console.log(
    `[catalog-quality-runner] Starting. Schedule: daily ${HOUR_UTC.toString().padStart(2, '0')}:${MIN_UTC.toString().padStart(2, '0')} UTC`
  );

  // Handle graceful shutdown
  const shutdown = (sig: string) => {
    console.log(`[catalog-quality-runner] Received ${sig}, shutting down`);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  schedule();
}

main().catch((err) => {
  console.error('[catalog-quality-runner] Fatal startup error:', err);
  process.exit(1);
});
