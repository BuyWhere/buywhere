"use strict";
/**
 * diskSpace.ts — Disk space monitoring and alerting (BUY-48801)
 *
 * Monitors /dev/vda1 free space and creates critical Paperclip incidents when
 * below 5GB (warns at 20GB). Runs every 5 minutes via diskSpaceRunner.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRITICAL_THRESHOLD_GB = exports.WARN_THRESHOLD_GB = void 0;
exports.getDiskSpaceInfo = getDiskSpaceInfo;
exports.checkDiskSpaceThresholds = checkDiskSpaceThresholds;
exports.createDiskSpaceIncident = createDiskSpaceIncident;
exports.shouldAlert = shouldAlert;
exports.markAlertSent = markAlertSent;
exports.runArtifactCleanup = runArtifactCleanup;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = require("path");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
// Thresholds in bytes
exports.WARN_THRESHOLD_GB = 20;
exports.CRITICAL_THRESHOLD_GB = 5;
const WARN_THRESHOLD_BYTES = exports.WARN_THRESHOLD_GB * 1024 * 1024 * 1024;
const CRITICAL_THRESHOLD_BYTES = exports.CRITICAL_THRESHOLD_GB * 1024 * 1024 * 1024;
// Paperclip API configuration
const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || 'https://api.paperclip.ai';
const PAPERCLIP_API_KEY = process.env.PAPERCLIP_API_KEY || '';
const PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID || '';
// Redis key for deduping alerts (prevent alert spam)
const ALERT_DEDUP_KEY = 'disk:alert:last';
/**
 * Get disk space information for /dev/vda1.
 * Falls back to / if /dev/vda1 is not found.
 */
async function getDiskSpaceInfo() {
    try {
        // First try /dev/vda1 specifically
        const result = await execAsync('df -B1 /dev/vda1');
        return parseDfOutput(result.stdout);
    }
    catch (err) {
        // If /dev/vda1 fails, fall back to root filesystem
        try {
            const result = await execAsync('df -B1 /');
            return parseDfOutput(result.stdout);
        }
        catch (fallbackErr) {
            console.error('[disk-space] Failed to get disk space info:', fallbackErr);
            return null;
        }
    }
}
function parseDfOutput(output) {
    const lines = output.trim().split('\n');
    if (lines.length < 2)
        return null;
    // Skip header, parse data line
    const line = lines[1].trim();
    const parts = line.split(/\s+/);
    if (parts.length < 6)
        return null;
    const filesystem = parts[0];
    const size = parseInt(parts[1], 10);
    const used = parseInt(parts[2], 10);
    const available = parseInt(parts[3], 10);
    const usePercent = parseInt(parts[4].replace('%', ''), 10);
    const mountPoint = parts[5];
    return {
        filesystem,
        size,
        used,
        available,
        usePercent,
        mountPoint,
    };
}
/**
 * Check if disk space is below thresholds.
 * Returns null if no alert is needed.
 */
async function checkDiskSpaceThresholds(info) {
    const availableGb = info.available / (1024 * 1024 * 1024);
    if (info.available <= CRITICAL_THRESHOLD_BYTES) {
        return {
            severity: 'critical',
            availableGb: Math.round(availableGb * 100) / 100,
            usePercent: info.usePercent,
            thresholdGb: exports.CRITICAL_THRESHOLD_GB,
            timestamp: new Date(),
        };
    }
    if (info.available <= WARN_THRESHOLD_BYTES) {
        return {
            severity: 'warning',
            availableGb: Math.round(availableGb * 100) / 100,
            usePercent: info.usePercent,
            thresholdGb: exports.WARN_THRESHOLD_GB,
            timestamp: new Date(),
        };
    }
    return null;
}
/**
 * Create a Paperclip incident for critical disk space.
 */
async function createDiskSpaceIncident(alert, info) {
    if (!PAPERCLIP_API_KEY || !PAPERCLIP_COMPANY_ID) {
        console.warn('[disk-space] PAPERCLIP_API_KEY or PAPERCLIP_COMPANY_ID not set — cannot create incident');
        return null;
    }
    const severity = alert.severity === 'critical' ? 'critical' : 'high';
    const status = alert.severity === 'critical' ? 'todo' : 'backlog';
    const title = `[${alert.severity.toUpperCase()}] Disk space low: ${alert.availableGb}GB available (${alert.usePercent}% used)`;
    const description = `## Disk Space Alert

**Severity:** ${alert.severity.toUpperCase()}
**Available:** ${alert.availableGb}GB
**Threshold:** ${alert.thresholdGb}GB minimum
**Used:** ${alert.usePercent}%
**Filesystem:** ${info.filesystem}
**Mount point:** ${info.mountPoint}
**Timestamp:** ${alert.timestamp.toISOString()}

### Action Required

${alert.severity === 'critical'
        ? '**CRITICAL:** Immediate action required to free up disk space or expand storage.'
        : '**WARNING:** Disk space is running low. Plan to free space or expand storage soon.'}

### Next Steps

1. Check large files/directories: \`du -sh /* | sort -h\`
2. Clean up old logs, temp files, or unnecessary data
3. Consider expanding disk volume if needed
4. Monitor until back above warning threshold

### Automated

This alert was generated by the disk space watchdog (BUY-48801).`;
    try {
        const response = await fetch(`${PAPERCLIP_API_URL}/api/companies/${PAPERCLIP_COMPANY_ID}/issues`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PAPERCLIP_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title,
                description,
                priority: severity,
                status,
                labels: [
                    { name: 'incident' },
                    { name: 'infrastructure' },
                    { name: 'disk-space' },
                    { name: alert.severity },
                ],
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[disk-space] Failed to create incident: ${response.status} ${errorText}`);
            return null;
        }
        const issue = (await response.json());
        console.log(`[disk-space] Created ${alert.severity} incident: ${issue.identifier} (${issue.id})`);
        return issue.id;
    }
    catch (err) {
        console.error('[disk-space] Error creating incident:', err);
        return null;
    }
}
/**
 * Check if we should alert (prevents alert spam).
 * Uses Redis to track last alert time for each severity level.
 */
async function shouldAlert(severity, redis) {
    try {
        const key = `${ALERT_DEDUP_KEY}:${severity}`;
        const lastAlertStr = await redis.get(key);
        if (!lastAlertStr) {
            return true; // No previous alert, should alert
        }
        const lastAlert = new Date(lastAlertStr);
        const now = new Date();
        const hoursSinceLastAlert = (now.getTime() - lastAlert.getTime()) / (1000 * 60 * 60);
        // Only alert if:
        // - Critical: at least 1 hour since last critical alert
        // - Warning: at least 24 hours since last warning alert
        const minHours = severity === 'critical' ? 1 : 24;
        return hoursSinceLastAlert >= minHours;
    }
    catch (err) {
        console.error('[disk-space] Error checking alert dedup:', err);
        return true; // On error, allow alert to be safe
    }
}
/**
 * Mark that an alert was sent (updates dedup state).
 */
async function markAlertSent(severity, redis) {
    try {
        const key = `${ALERT_DEDUP_KEY}:${severity}`;
        await redis.set(key, new Date().toISOString(), 'EX', 86400); // 24 hour TTL
    }
    catch (err) {
        console.error('[disk-space] Error marking alert sent:', err);
    }
}
/**
 * Run the worker node artifact cleanup script.
 * Script prunes orphaned WC cycle ndjson files, stale pid/heartbeat files, old logs.
 *
 * @param apply - If true, actually delete files; otherwise dry-run
 * @param retentionHours - Delete artifacts older than this many hours (default: 48)
 */
async function runArtifactCleanup(apply = false, retentionHours = 48) {
    const cleanupScriptPath = (0, path_1.resolve)(__dirname, '../../../../scripts/buy-53114-worker-node-artifact-cleanup.sh');
    if (!(0, fs_1.existsSync)(cleanupScriptPath)) {
        return {
            success: false,
            scannedCount: 0,
            removedCount: 0,
            reclaimedKb: 0,
            alertRequired: false,
            error: `Cleanup script not found at: ${cleanupScriptPath}`,
        };
    }
    const applyFlag = apply ? '1' : '0';
    const reportPath = process.env.ARTIFACT_CLEANUP_REPORT_PATH || '/tmp/artifact_cleanup_report.json';
    try {
        const { stdout, stderr, exitCode } = await execAsync(`WORKSPACES_ROOT="${process.env.WORKSPACES_ROOT || '/paperclip/instances/default/workspaces'}" ` +
            `APPLY=${applyFlag} ` +
            `DISK_ARTIFACT_RETENTION_DAYS=${Math.ceil(retentionHours / 24)} ` +
            `REPORT_PATH="${reportPath}" ` +
            `bash "${cleanupScriptPath}"`, { timeout: 300000 } // 5 min timeout
        );
        // Read the JSON report if it was written
        try {
            const { readFile } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            const reportContent = await readFile(reportPath, 'utf-8');
            const report = JSON.parse(reportContent);
            return {
                success: exitCode === 0,
                scannedCount: report.scanned_count || 0,
                removedCount: report.removed_count || 0,
                reclaimedKb: report.reclaimed_kb || 0,
                alertRequired: report.alert_required === 1,
                error: exitCode !== 0 ? `Script exited with code ${exitCode}` : undefined,
            };
        }
        catch {
            // Report file not available, return basic info from exit code
            return {
                success: exitCode === 0,
                scannedCount: 0,
                removedCount: 0,
                reclaimedKb: 0,
                alertRequired: false,
                error: exitCode !== 0 ? `Script exited with code ${exitCode}` : undefined,
            };
        }
    }
    catch (err) {
        return {
            success: false,
            scannedCount: 0,
            removedCount: 0,
            reclaimedKb: 0,
            alertRequired: false,
            error: err.message || String(err),
        };
    }
}
