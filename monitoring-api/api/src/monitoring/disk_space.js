// BUY-56114 Disk Space Watchdog (5min)
// Probe, record, and alert on disk usage per mount point.
// Critical: < 5GB free. Warn: < 20GB free. Creates Paperclip incidents.

const { execSync } = require('child_process');

// Environment overrides
const DISK_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DISK_ALERT_THRESHOLD_PCT = parseFloat(process.env.DISK_ALERT_THRESHOLD_PCT || '85');
const DISK_ALERT_KIND = 'disk_space';

// Thresholds in bytes
const WARN_THRESHOLD_GB = 20;
const CRITICAL_THRESHOLD_GB = 5;
const WARN_THRESHOLD_BYTES = WARN_THRESHOLD_GB * 1024 * 1024 * 1024;
const CRITICAL_THRESHOLD_BYTES = CRITICAL_THRESHOLD_GB * 1024 * 1024 * 1024;

// Paperclip API configuration
const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || 'https://api.paperclip.ai';
const PAPERCLIP_API_KEY = process.env.PAPERCLIP_API_KEY || '';
const PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID || '';

// Parse `df -B1` output into structured rows.
// We skip the header line and the special tmpfs/squashfs mounts that
// Railway containers typically expose, keeping only real filesystems.
function parseDfOutput(stdout) {
  const lines = stdout.trim().split('\n').slice(1);
  const mounts = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [filesystem, total, used, free, pctStr, mount] = parts;
    // Skip pseudo-filesystems
    if (filesystem === 'tmpfs' || filesystem === 'devtmpfs' || filesystem.startsWith('overlay') || filesystem.startsWith('squashfs')) continue;
    const usagePct = parseFloat(pctStr.replace('%', ''));
    mounts.push({
      filesystem,
      mount_point: mount,
      total_bytes: parseInt(total, 10),
      used_bytes: parseInt(used, 10),
      free_bytes: parseInt(free, 10),
      usage_pct: usagePct,
    });
  }
  return mounts;
}

/**
 * Probe current disk usage and return mount rows.
 */
function probeDiskUsage() {
  try {
    const stdout = execSync('df -B1', { encoding: 'utf8', timeout: 10_000 });
    return parseDfOutput(stdout);
  } catch (err) {
    console.error('[disk_space] Failed to run df:', err.message);
    return [];
  }
}

/**
 * Record a disk usage snapshot into the DB.
 */
async function recordDiskUsage(pool, mounts) {
  for (const mount of mounts) {
    try {
      await pool.query(
        `INSERT INTO monitoring.disk_space
         (mount_point, total_bytes, used_bytes, free_bytes, usage_pct, alert_threshold)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [mount.mount_point, mount.total_bytes, mount.used_bytes, mount.free_bytes, mount.usage_pct, DISK_ALERT_THRESHOLD_PCT]
      );
    } catch (err) {
      console.error(`[disk_space] DB insert failed for ${mount.mount_point}:`, err.message);
    }
  }
}

/**
 * Check free bytes thresholds and determine severity.
 */
function checkFreeBytesThreshold(freeBytes) {
  if (freeBytes <= CRITICAL_THRESHOLD_BYTES) {
    return 'critical';
  }
  if (freeBytes <= WARN_THRESHOLD_BYTES) {
    return 'warning';
  }
  return null;
}

/**
 * Insert a disk-space alert into monitoring.alert_history if usage
 * exceeds the threshold and we haven't already alerted within the
 * last 30 minutes (deduplication window).
 */
async function maybeAlert(pool, mounts) {
  const now = new Date();
  const dedupWindowMinutes = 30;
  const dedupWindowAgo = new Date(now.getTime() - dedupWindowMinutes * 60 * 1000);

  for (const mount of mounts) {
    const severity = checkFreeBytesThreshold(mount.free_bytes);
    if (!severity) continue; // Below threshold, no alert

    // Percentage threshold still applies for DB alerts
    if (mount.usage_pct < DISK_ALERT_THRESHOLD_PCT && severity !== 'critical') continue;

    try {
      // Check for recent duplicate alert (same severity + mount)
      const dupCheck = await pool.query(
        `SELECT 1 FROM monitoring.alert_history
         WHERE kind = 'disk_space'
           AND triggered_at > $1
           AND resolution_notes LIKE $2
         LIMIT 1`,
        [dedupWindowAgo, `%mount=${mount.mount_point}; severity=${severity}%`]
      );
      if (dupCheck.rowCount > 0) {
        console.log(`[disk_space] Deduplicated ${severity} alert for ${mount.mount_point} (${mount.free_bytes} bytes free)`);
        continue;
      }

      // Insert alert
      const fingerprint = JSON.stringify({
        mount: mount.mount_point,
        usage_pct: mount.usage_pct,
        free_bytes: mount.free_bytes,
        severity,
      });
      await pool.query(
        `INSERT INTO monitoring.alert_history
         (market, p95_ms, threshold_ms, kind, resolution_notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          'global',                              // market
          mount.free_bytes,                      // p95_ms (reused for free bytes)
          severity === 'critical' ? CRITICAL_THRESHOLD_BYTES : WARN_THRESHOLD_BYTES, // threshold
          DISK_ALERT_KIND,
          `mount=${mount.mount_point}; free_bytes=${mount.free_bytes}; usage_pct=${mount.usage_pct}; severity=${severity}; fingerprint=${fingerprint}`,
        ]
      );
      console.warn(
        `[BUY-56114 Alert] Disk space ${severity}: ` +
        `mount=${mount.mount_point} free_bytes=${mount.free_bytes} ` +
        `usage_pct=${mount.usage_pct}%`
      );
    } catch (err) {
      console.error(`[disk_space] Alert insert failed for ${mount.mount_point}:`, err.message);
    }
  }
}

/**
 * Create a Paperclip incident for critical disk space.
 */
async function createPaperclipIncident(mount, severity) {
  if (!PAPERCLIP_API_KEY || !PAPERCLIP_COMPANY_ID) {
    console.warn('[disk_space] PAPERCLIP_API_KEY or PAPERCLIP_COMPANY_ID not set — cannot create incident');
    return null;
  }

  const availableGb = Math.round((mount.free_bytes / (1024 * 1024 * 1024)) * 100) / 100;
  const priority = severity === 'critical' ? 'critical' : 'high';
  const status = severity === 'critical' ? 'todo' : 'backlog';
  const title = `[${severity.toUpperCase()}] Disk space low: ${availableGb}GB available on ${mount.mount_point} (${mount.usage_pct}% used)`;
  const description = `## Disk Space Alert

**Severity:** ${severity.toUpperCase()}
**Available:** ${availableGb}GB
**Mount:** ${mount.mount_point}
**Used:** ${mount.usage_pct}%
**Filesystem:** ${mount.filesystem}
**Timestamp:** ${new Date().toISOString()}

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

This alert was generated by the disk space watchdog (BUY-56114).`;

  try {
    const response = await fetch(`${PAPERCLIP_API_URL}/api/companies/${PAPERCLIP_COMPANY_ID}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAPERCLIP_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Paperclip-Run-Id': process.env.PAPERCLIP_RUN_ID || '',
      },
      body: JSON.stringify({
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
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[disk_space] Failed to create incident: ${response.status} ${errorText}`);
      return null;
    }

    const issue = await response.json();
    console.log(`[disk_space] Created ${severity} incident: ${issue.identifier} (${issue.id})`);
    return issue.id;
  } catch (err) {
    console.error('[disk_space] Error creating incident:', err.message);
    return null;
  }
}

/**
 * Get latest disk usage for all mounts.
 */
async function getLatestDiskUsage(pool) {
  const result = await pool.query(
    `SELECT DISTINCT ON (mount_point)
            mount_point,
            total_bytes,
            used_bytes,
            free_bytes,
            usage_pct,
            alert_threshold,
            measured_at
     FROM monitoring.disk_space
     ORDER BY mount_point, measured_at DESC`
  );
  return result.rows;
}

/**
 * Get disk usage history for a mount point.
 */
async function getDiskHistory(pool, mountPoint, limit = 100) {
  const maxLimit = Math.min(limit, 1000);
  const result = await pool.query(
    `SELECT measured_at, total_bytes, used_bytes, free_bytes, usage_pct, alert_threshold
     FROM monitoring.disk_space
     WHERE mount_point = $1
     ORDER BY measured_at DESC
     LIMIT $2`,
    [mountPoint, maxLimit]
  );
  return {
    mount_point: mountPoint,
    data: result.rows,
    count: result.rowCount,
  };
}

/**
 * Single probe-and-record cycle.
 */
async function probeAndRecordDiskSpace(pool) {
  const mounts = probeDiskUsage();
  if (mounts.length === 0) {
    console.warn('[disk_space] No mount points returned from df');
    return;
  }
  await recordDiskUsage(pool, mounts);
  await maybeAlert(pool, mounts);

  // Check for critical/warn thresholds and create Paperclip incidents
  for (const mount of mounts) {
    const severity = checkFreeBytesThreshold(mount.free_bytes);
    if (severity) {
      console.warn(
        `[disk_space] ${severity.toUpperCase()} threshold breached: ` +
        `${mount.mount_point} free=${mount.free_bytes} bytes ` +
        `(${Math.round((mount.free_bytes / (1024*1024*1024)) * 100) / 100}GB)`
      );
      // Only create Paperclip incidents (not just DB alerts)
      await createPaperclipIncident(mount, severity);
    }
    console.log(`[disk_space] ${mount.mount_point} -> ${mount.usage_pct}% used (${mount.free_bytes} free bytes)`);
  }
}

module.exports = {
  DISK_CHECK_INTERVAL_MS,
  DISK_ALERT_THRESHOLD_PCT,
  DISK_ALERT_KIND,
  WARN_THRESHOLD_GB,
  CRITICAL_THRESHOLD_GB,
  WARN_THRESHOLD_BYTES,
  CRITICAL_THRESHOLD_BYTES,
  probeDiskUsage,
  recordDiskUsage,
  maybeAlert,
  createPaperclipIncident,
  getLatestDiskUsage,
  getDiskHistory,
  probeAndRecordDiskSpace,
};
