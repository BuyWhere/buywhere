#!/usr/bin/env node
/**
 * buy-38913-disk-space-watchdog.js — Disk Space Watchdog
 *
 * Monitors /dev/vda1 free space and creates critical Paperclip incidents when
 * below 5GB (warns at 20GB). Runs every 5 minutes via cron or wrapper script.
 *
 * Usage:
 *   DISK_STATE_FILE=/tmp/buy-48198-disk-state.json \
 *   DISK_EXECUTION_ISSUE=BUY-48198 \
 *   DISK_SNAPSHOT_DIR=data/BUY-48198-disk-check-<ts> \
 *     node scripts/buy-38913-disk-space-watchdog.js
 *
 * Exit codes:
 *   0 = OK (no alert needed)
 *   1 = WARN (below 20GB threshold)
 *   2 = CRITICAL (below 5GB threshold)
 *   3 = ERROR (unable to check disk space)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');
const https = require('https');

// Configuration
const STATE_FILE = process.env.DISK_STATE_FILE || '/tmp/buy-48198-disk-state.json';
const EXECUTION_ISSUE = process.env.DISK_EXECUTION_ISSUE || 'BUY-48198';
const SNAPSHOT_DIR = process.env.DISK_SNAPSHOT_DIR;
const WARN_THRESHOLD_GB = parseInt(process.env.DISK_WARN_THRESHOLD_GB || '20', 10);
const CRITICAL_THRESHOLD_GB = parseInt(process.env.DISK_CRITICAL_THRESHOLD_GB || '5', 10);
const ALERT_COOLDOWN_HOURS = parseInt(process.env.DISK_ALERT_COOLDOWN_HOURS || '1', 10);

// Paperclip API
const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || 'https://api.paperclip.ai';
const PAPERCLIP_API_KEY = process.env.PAPERCLIP_API_KEY || '';
const PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID || '';
const PAPERCLIP_RUN_ID = process.env.PAPERCLIP_RUN_ID || '';
const ALERT_SINK = process.env.DISK_ALERT_SINK || 'BUY-48198';

// Thresholds in bytes
const WARN_THRESHOLD_BYTES = WARN_THRESHOLD_GB * 1024 * 1024 * 1024;
const CRITICAL_THRESHOLD_BYTES = CRITICAL_THRESHOLD_GB * 1024 * 1024 * 1024;

/**
 * Get disk space information for /dev/vda1.
 * Falls back to / if /dev/vda1 is not found.
 */
function getDiskSpaceInfo() {
  try {
    // First try /dev/vda1 specifically
    const result = execSync('df -B1 /dev/vda1 2>/dev/null || df -B1 /', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return parseDfOutput(result);
  } catch (err) {
    console.error('[disk-space] Failed to get disk space info:', err.message);
    return null;
  }
}

/**
 * Parse df command output.
 * Expected format:
 * Filesystem     1B-blocks        Used   Available Capacity Mounted on
 * /dev/vda1      206900281344 174306951168 32576552960      85% /
 */
function parseDfOutput(output) {
  const lines = output.trim().split('\n');
  if (lines.length < 2) return null;

  // Skip header, parse data line
  const line = lines[1].trim();
  const parts = line.split(/\s+/);
  if (parts.length < 6) return null;

  const filesystem = parts[0];
  const size = parseInt(parts[1], 10);
  const used = parseInt(parts[2], 10);
  const available = parseInt(parts[3], 10);
  const usePercent = parseInt(parts[4].replace('%', ''), 10);
  const mountPoint = parts[5];

  return { filesystem, size, used, available, usePercent, mountPoint };
}

/**
 * Read state from file for alert deduplication.
 */
function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { lastCriticalAlert: null, lastWarningAlert: null };
  }
}

/**
 * Write state to file.
 */
function writeState(state) {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Check if alert should be sent (cooldown logic).
 */
function shouldAlert(severity, state) {
  const now = Date.now();
  const lastAlert = severity === 'critical' ? state.lastCriticalAlert : state.lastWarningAlert;

  if (!lastAlert) return true;

  const hoursSinceLastAlert = (now - new Date(lastAlert).getTime()) / (1000 * 60 * 60);
  return hoursSinceLastAlert >= ALERT_COOLDOWN_HOURS;
}

/**
 * Create a Paperclip incident for disk space alert.
 */
async function createDiskSpaceIncident(alert, info) {
  if (!PAPERCLIP_API_KEY || !PAPERCLIP_COMPANY_ID) {
    console.warn('[disk-space] PAPERCLIP_API_KEY or PAPERCLIP_COMPANY_ID not set — skipping incident creation');
    return null;
  }

  const severity = alert.severity;
  const status = severity === 'critical' ? 'todo' : 'backlog';
  const priority = severity === 'critical' ? 'critical' : 'high';
  const title = `[${severity.toUpperCase()}] Disk space low: ${alert.availableGb}GB available (${alert.usePercent}% used)`;

  const description = `## Disk Space Alert

**Severity:** ${severity.toUpperCase()}
**Available:** ${alert.availableGb}GB
**Threshold:** ${alert.thresholdGb}GB minimum
**Used:** ${alert.usePercent}%
**Filesystem:** ${info.filesystem}
**Mount point:** ${info.mountPoint}
**Timestamp:** ${alert.timestamp.toISOString()}

### Action Required

${severity === 'critical'
    ? '**CRITICAL:** Immediate action required to free up disk space or expand storage.'
    : '**WARNING:** Disk space is running low. Plan to free space or expand storage soon.'}

### Next Steps

1. Check large files/directories: \`du -sh /* | sort -h\`
2. Clean up old logs, temp files, or unnecessary data
3. Consider expanding disk volume if needed
4. Monitor until back above warning threshold

### Automated

This alert was generated by the disk space watchdog (${EXECUTION_ISSUE}).`;

  try {
    const url = new URL(`${PAPERCLIP_API_URL}/api/companies/${PAPERCLIP_COMPANY_ID}/issues`);
    const transport = url.protocol === 'http:' ? http : https;

    const body = JSON.stringify({
      title,
      description,
      priority,
      status,
      labels: [
        { name: 'incident' },
        { name: 'infrastructure' },
        { name: 'disk-space' },
        { name: severity },
      ],
    });

    await new Promise((resolve, reject) => {
      const opts = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        headers: {
          'Authorization': `Bearer ${PAPERCLIP_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(PAPERCLIP_RUN_ID ? { 'X-Paperclip-Run-Id': PAPERCLIP_RUN_ID } : {}),
        },
      };

      const req = transport.request(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const issue = JSON.parse(data);
              console.log(`[disk-space] Created ${severity} incident: ${issue.identifier} (${issue.id})`);
              resolve(issue.id);
            } catch (err) {
              reject(new Error(`Failed to parse response: ${err.message}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });

    return { created: true };
  } catch (err) {
    console.error(`[disk-space] Failed to create incident:`, err.message);
    return null;
  }
}

async function main() {
  const generatedAt = new Date().toISOString();
  const state = readState();
  const info = getDiskSpaceInfo();

  if (!info) {
    const result = {
      generated_at: generatedAt,
      status: 'ERROR',
      notes: ['Failed to get disk space information'],
      execution_identifier: EXECUTION_ISSUE,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(3);
  }

  const availableGb = info.available / (1024 * 1024 * 1024);
  const availableGbRounded = Math.round(availableGb * 100) / 100;
  let verdict = 'OK';
  let alert = null;
  const notes = [];

  notes.push(`Filesystem: ${info.filesystem} at ${info.mountPoint}`);
  notes.push(`Available: ${availableGbRounded}GB (${info.usePercent}% used)`);

  // Check thresholds
  if (info.available <= CRITICAL_THRESHOLD_BYTES) {
    verdict = 'CRITICAL';
    alert = {
      severity: 'critical',
      availableGb: availableGbRounded,
      usePercent: info.usePercent,
      thresholdGb: CRITICAL_THRESHOLD_GB,
      timestamp: new Date(generatedAt),
    };
    notes.push(`CRITICAL: Below ${CRITICAL_THRESHOLD_GB}GB threshold`);
  } else if (info.available <= WARN_THRESHOLD_BYTES) {
    verdict = 'WARN';
    alert = {
      severity: 'warning',
      availableGb: availableGbRounded,
      usePercent: info.usePercent,
      thresholdGb: WARN_THRESHOLD_GB,
      timestamp: new Date(generatedAt),
    };
    notes.push(`WARNING: Below ${WARN_THRESHOLD_GB}GB threshold`);
  } else {
    notes.push('OK: Disk space healthy');
  }

  // Create incident if alert and within cooldown
  let incidentCreated = null;
  if (alert) {
    const canAlert = shouldAlert(alert.severity, state);
    if (canAlert) {
      console.warn(`[disk-space] ${alert.severity.toUpperCase()}: ${alert.availableGb}GB available`);
      incidentCreated = await createDiskSpaceIncident(alert, info);
      if (incidentCreated) {
        if (alert.severity === 'critical') {
          state.lastCriticalAlert = generatedAt;
        } else {
          state.lastWarningAlert = generatedAt;
        }
        writeState(state);
      }
    } else {
      notes.push(`Alert cooldown active (last ${alert.severity} alert within ${ALERT_COOLDOWN_HOURS}h)`);
    }
  }

  const result = {
    generated_at: generatedAt,
    status: verdict,
    notes,
    disk_info: {
      filesystem: info.filesystem,
      mountPoint: info.mountPoint,
      size_gb: Math.round(info.size / (1024 * 1024 * 1024)),
      used_gb: Math.round(info.used / (1024 * 1024 * 1024)),
      available_gb: availableGbRounded,
      use_percent: info.usePercent,
    },
    thresholds: {
      warn_gb: WARN_THRESHOLD_GB,
      critical_gb: CRITICAL_THRESHOLD_GB,
    },
    alert: alert
      ? {
          severity: alert.severity,
          available_gb: alert.availableGb,
          threshold_gb: alert.thresholdGb,
        }
      : null,
    incident_created: incidentCreated ? true : false,
    execution_identifier: EXECUTION_ISSUE,
    source_identifier: 'BUY-48198',
  };

  console.log(JSON.stringify(result, null, 2));

  if (SNAPSHOT_DIR) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(SNAPSHOT_DIR, 'result.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(SNAPSHOT_DIR, 'state.json'), JSON.stringify(state, null, 2));
    fs.writeFileSync(path.join(SNAPSHOT_DIR, 'status.txt'), `${result.status}\n`);

    const summaryLines = [
      `# Disk Space Watchdog (${EXECUTION_ISSUE})`,
      ``,
      `- Generated at: \`${generatedAt}\``,
      `- Result: \`${result.status}\``,
      `- Filesystem: \`${info.filesystem}\``,
      `- Mount point: \`${info.mountPoint}\``,
      `- Available: \`${availableGbRounded}GB\` (\`${info.usePercent}%\` used)`,
      `- Thresholds: Warn \`${WARN_THRESHOLD_GB}GB\`, Critical \`${CRITICAL_THRESHOLD_GB}GB\``,
      ``,
      `## Status`,
      ``,
      verdict === 'OK' ? '✅ Disk space healthy' : verdict === 'WARN' ? '⚠️ Warning threshold breached' : '🚨 Critical threshold breached',
      ``,
    ];

    if (alert) {
      summaryLines.push(`## Alert`, ``, `- Severity: \`${alert.severity.toUpperCase()}\``, `- Created incident: \`${incidentCreated ? 'yes' : 'no'}\``, ``);
    }

    if (notes && notes.length) {
      summaryLines.push(`## Notes`, ``);
      for (const n of notes) summaryLines.push(`- ${n}`);
    }

    fs.writeFileSync(path.join(SNAPSHOT_DIR, 'summary.md'), summaryLines.join('\n') + '\n');
  }

  if (verdict === 'OK') process.exit(0);
  if (verdict === 'WARN') process.exit(1);
  if (verdict === 'CRITICAL') process.exit(2);
  process.exit(3);
}

main().catch((err) => {
  console.error('FATAL', err && err.stack ? err.stack : err);
  process.exit(3);
});
