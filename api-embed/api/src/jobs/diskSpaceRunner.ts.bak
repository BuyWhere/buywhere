/**
 * diskSpaceRunner.ts — Periodic disk space monitoring (BUY-48801)
 *
 * Runs every 5 minutes. Checks /dev/vda1 free space and creates critical
 * Paperclip incidents when below 5GB (warns at 20GB).
 *
 * Override interval via env: DISK_SPACE_CHECK_INTERVAL_MS (default: 300000 = 5 min)
 */

import { redis } from '../config';
import {
  getDiskSpaceInfo,
  checkDiskSpaceThresholds,
  createDiskSpaceIncident,
  shouldAlert,
  markAlertSent,
  CRITICAL_THRESHOLD_GB,
  WARN_THRESHOLD_GB,
} from '../monitoring/diskSpace';

const INTERVAL_MS = parseInt(process.env.DISK_SPACE_CHECK_INTERVAL_MS || '300000', 10);

async function tick(): Promise<void> {
  try {
    const info = await getDiskSpaceInfo();
    if (!info) {
      console.warn('[disk-space-runner] Failed to get disk space info');
      return;
    }

    const availableGb = info.available / (1024 * 1024 * 1024);
    console.log(
      `[disk-space-runner] ${info.filesystem} at ${info.mountPoint}: ` +
      `${Math.round(availableGb * 100) / 100}GB available (${info.usePercent}% used)`
    );

    const alert = await checkDiskSpaceThresholds(info);
    if (!alert) {
      console.log('[disk-space-runner] Disk space OK — no alert needed');
      return;
    }

    // Check if we should alert (prevents spam)
    const canAlert = await shouldAlert(alert.severity, redis);
    if (!canAlert) {
      console.log(
        `[disk-space-runner] ${alert.severity.toUpperCase()} alert already sent recently — skipping`
      );
      return;
    }

    // Create Paperclip incident
    console.warn(
      `[disk-space-runner] ${alert.severity.toUpperCase()}: ${alert.availableGb}GB available ` +
      `(threshold: ${alert.thresholdGb}GB, ${alert.usePercent}% used)`
    );

    const issueId = await createDiskSpaceIncident(alert, info);
    if (issueId) {
      await markAlertSent(alert.severity, redis);
      console.log(`[disk-space-runner] Created incident: ${issueId}`);
    } else {
      console.error('[disk-space-runner] Failed to create incident');
    }
  } catch (err) {
    console.error('[disk-space-runner] Tick error:', err);
  }
}

/**
 * Start the disk space monitoring loop. Runs every INTERVAL_MS.
 * Safe to call from the main API server process.
 */
export function startDiskSpaceRunner(): void {
  console.log(
    `[disk-space-runner] Starting disk space monitoring (every ${INTERVAL_MS / 1000}s, ` +
    `warn threshold=${WARN_THRESHOLD_GB}GB, critical threshold=${CRITICAL_THRESHOLD_GB}GB)`
  );

  // First tick after 10 seconds to let the server warm up
  setTimeout(() => {
    tick();
    const timer = setInterval(tick, INTERVAL_MS);
    // Prevent the timer from keeping the process alive during shutdown
    if (timer.unref) {
      timer.unref();
    }
  }, 10_000);
}

// Standalone mode: run once and exit (for manual execution)
async function main(): Promise<void> {
  console.log('[disk-space-runner] Running disk space check once...');
  await tick();
  console.log('[disk-space-runner] Done.');
  redis.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[disk-space-runner] Fatal:', err);
    process.exit(1);
  });
}