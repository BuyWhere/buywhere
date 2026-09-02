"use strict";
/**
 * diskSpaceRunner.ts — Periodic disk space monitoring (BUY-48801)
 *
 * Runs every 5 minutes. Checks /dev/vda1 free space and creates critical
 * Paperclip incidents when below 5GB (warns at 20GB).
 *
 * Override interval via env: DISK_SPACE_CHECK_INTERVAL_MS (default: 300000 = 5 min)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDiskSpaceRunner = startDiskSpaceRunner;
const config_1 = require("../config");
const diskSpace_1 = require("../monitoring/diskSpace");
const INTERVAL_MS = parseInt(process.env.DISK_SPACE_CHECK_INTERVAL_MS || '300000', 10);
async function tick() {
    try {
        const info = await (0, diskSpace_1.getDiskSpaceInfo)();
        if (!info) {
            console.warn('[disk-space-runner] Failed to get disk space info');
            return;
        }
        const availableGb = info.available / (1024 * 1024 * 1024);
        console.log(`[disk-space-runner] ${info.filesystem} at ${info.mountPoint}: ` +
            `${Math.round(availableGb * 100) / 100}GB available (${info.usePercent}% used)`);
        const alert = await (0, diskSpace_1.checkDiskSpaceThresholds)(info);
        if (!alert) {
            console.log('[disk-space-runner] Disk space OK — no alert needed');
            return;
        }
        // Check if we should alert (prevents spam)
        const canAlert = await (0, diskSpace_1.shouldAlert)(alert.severity, config_1.redis);
        if (!canAlert) {
            console.log(`[disk-space-runner] ${alert.severity.toUpperCase()} alert already sent recently — skipping`);
            return;
        }
        // Run WC cycle artifact cleanup before opening an incident.
        // Auto-apply only at critical severity; warning stays dry-run for safety.
        const retentionHours = parseInt(process.env.ARTIFACT_CLEANUP_RETENTION_HOURS || '48', 10);
        const autoApply = alert.severity === 'critical' && process.env.ARTIFACT_CLEANUP_AUTO_APPLY !== '0';
        const cleanupReport = await (0, diskSpace_1.runArtifactCleanup)(autoApply, retentionHours);
        if (cleanupReport.removedCount > 0 || cleanupReport.alertRequired) {
            console.warn(`[disk-space-runner] cleanup applied=${autoApply} ` +
                `scanned=${cleanupReport.scannedCount} removed=${cleanupReport.removedCount} ` +
                `reclaimed_kb=${cleanupReport.reclaimedKb} alert_required=${cleanupReport.alertRequired}` +
                (cleanupReport.error ? ` error=${cleanupReport.error}` : ''));
        }
        else {
            console.log(`[disk-space-runner] cleanup applied=${autoApply} ` +
                `scanned=${cleanupReport.scannedCount} removed=${cleanupReport.removedCount} ` +
                `reclaimed_kb=${cleanupReport.reclaimedKb}` +
                (cleanupReport.error ? ` error=${cleanupReport.error}` : ''));
        }
        // Create Paperclip incident
        console.warn(`[disk-space-runner] ${alert.severity.toUpperCase()}: ${alert.availableGb}GB available ` +
            `(threshold: ${alert.thresholdGb}GB, ${alert.usePercent}% used)`);
        const issueId = await (0, diskSpace_1.createDiskSpaceIncident)(alert, info);
        if (issueId) {
            await (0, diskSpace_1.markAlertSent)(alert.severity, config_1.redis);
            console.log(`[disk-space-runner] Created incident: ${issueId}`);
        }
        else {
            console.error('[disk-space-runner] Failed to create incident');
        }
    }
    catch (err) {
        console.error('[disk-space-runner] Tick error:', err);
    }
}
/**
 * Start the disk space monitoring loop. Runs every INTERVAL_MS.
 * Safe to call from the main API server process.
 */
function startDiskSpaceRunner() {
    console.log(`[disk-space-runner] Starting disk space monitoring (every ${INTERVAL_MS / 1000}s, ` +
        `warn threshold=${diskSpace_1.WARN_THRESHOLD_GB}GB, critical threshold=${diskSpace_1.CRITICAL_THRESHOLD_GB}GB)`);
    // First tick after 10 seconds to let the server warm up
    setTimeout(() => {
        tick();
        const timer = setInterval(tick, INTERVAL_MS);
        // Prevent the timer from keeping the process alive during shutdown
        if (timer.unref) {
            timer.unref();
        }
    }, 10000);
}
// Standalone mode: run once and exit (for manual execution)
async function main() {
    console.log('[disk-space-runner] Running disk space check once...');
    await tick();
    console.log('[disk-space-runner] Done.');
    config_1.redis.disconnect();
}
if (require.main === module) {
    main().catch((err) => {
        console.error('[disk-space-runner] Fatal:', err);
        process.exit(1);
    });
}
