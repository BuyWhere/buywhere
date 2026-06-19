#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');
const https = require('https');

const STATE_FILE = process.env.DISK_STATE_FILE || '/tmp/buy-48198-disk-state.json';
const SNAPSHOT_DIR = process.env.DISK_SNAPSHOT_DIR || '';
const EXECUTION_ISSUE = process.env.DISK_EXECUTION_ISSUE || 'BUY-48198';
const ROUTINE_IDENTIFIER = process.env.DISK_ROUTINE_IDENTIFIER || 'BUY-48198';
const FILESYSTEM_LABEL = process.env.DISK_FILESYSTEM_LABEL || '/dev/vda1';
const MOUNT_PATH = process.env.DISK_MOUNT_PATH || '/';
const WARN_BYTES = parseInt(
  process.env.DISK_WARN_BYTES || String(20 * 1024 * 1024 * 1024),
  10
);
const CRITICAL_BYTES = parseInt(
  process.env.DISK_CRITICAL_BYTES || String(5 * 1024 * 1024 * 1024),
  10
);
const ALERT_COOLDOWN_HOURS = parseInt(process.env.DISK_ALERT_COOLDOWN_HOURS || '1', 10);
const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || '';
const PAPERCLIP_API_KEY = process.env.PAPERCLIP_API_KEY || '';
const PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID || '';
const PAPERCLIP_RUN_ID = process.env.PAPERCLIP_RUN_ID || '';

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function ensureDir(dirPath) {
  if (dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function formatGb(bytes) {
  return Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10;
}

function buildIncidentTitle(freeBytes) {
  return `[INCIDENT] ${FILESYSTEM_LABEL} disk below 5 GB — ${formatGb(freeBytes)} GB free`;
}

function matchesOpenIncidentTitle(title) {
  const escaped = FILESYSTEM_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\[INCIDENT\\] ${escaped} disk below 5 GB — [0-9]+(?:\\.[0-9]+)? GB free$`).test(title);
}

function parseDfOutput(output) {
  const lines = output.trim().split('\n');
  if (lines.length < 2) return null;
  const parts = lines[1].trim().split(/\s+/);
  if (parts.length < 6) return null;
  return {
    filesystem: parts[0],
    sizeBytes: parseInt(parts[1], 10),
    usedBytes: parseInt(parts[2], 10),
    availableBytes: parseInt(parts[3], 10),
    usePercent: parseInt(parts[4].replace('%', ''), 10),
    mountPoint: parts[5],
  };
}

function getDiskSpaceInfo() {
  const probes = [`df -B1 ${MOUNT_PATH}`, 'df -B1 /'];
  for (const probe of probes) {
    try {
      const output = execSync(probe, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const info = parseDfOutput(output);
      if (info) return info;
    } catch (_err) {
    }
  }
  return null;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_err) {
    return { lastWarningAlertAt: null, lastCriticalAlertAt: null };
  }
}

function writeState(state) {
  ensureParentDir(STATE_FILE);
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    ...state,
    updatedAt: new Date().toISOString(),
  }, null, 2));
}

function shouldAlert(severity, state, now) {
  const field = severity === 'critical' ? 'lastCriticalAlertAt' : 'lastWarningAlertAt';
  const last = state[field];
  if (!last) return true;
  const elapsedHours = (now.getTime() - new Date(last).getTime()) / (1000 * 60 * 60);
  return elapsedHours >= ALERT_COOLDOWN_HOURS;
}

async function createIncident(title, description, priority, status) {
  if (!PAPERCLIP_API_URL || !PAPERCLIP_API_KEY || !PAPERCLIP_COMPANY_ID) {
    return null;
  }
  const body = JSON.stringify({
    title,
    description,
    priority,
    status,
    labels: [
      { name: 'incident' },
      { name: 'infrastructure' },
      { name: 'disk-space' },
    ],
  });
  const url = new URL(`${PAPERCLIP_API_URL}/api/companies/${PAPERCLIP_COMPANY_ID}/issues`);
  const transport = url.protocol === 'http:' ? http : https;
  return await new Promise((resolve) => {
    const req = transport.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: `${url.pathname}${url.search}`,
      headers: {
        Authorization: `Bearer ${PAPERCLIP_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(PAPERCLIP_RUN_ID ? { 'X-Paperclip-Run-Id': PAPERCLIP_RUN_ID } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if ((res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (_err) {
            resolve({ raw: data });
          }
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

function writeSnapshot(result, state) {
  if (!SNAPSHOT_DIR) return;
  ensureDir(SNAPSHOT_DIR);
  fs.writeFileSync(path.join(SNAPSHOT_DIR, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(SNAPSHOT_DIR, 'state.json'), JSON.stringify(state, null, 2));
  fs.writeFileSync(path.join(SNAPSHOT_DIR, 'status.txt'), `${result.status}\n`);
  const summary = [
    `# ${EXECUTION_ISSUE} Disk Space Watchdog`,
    '',
    `- Routine: \`${ROUTINE_IDENTIFIER}\``,
    `- Execution issue: \`${EXECUTION_ISSUE}\``,
    `- Generated at: \`${result.generated_at}\``,
    `- Filesystem: \`${result.filesystem}\``,
    `- Mount path: \`${result.mount_path}\``,
    `- Free space: \`${result.free_gb} GB\``,
    `- Warn threshold: \`${result.warn_gb} GB\``,
    `- Critical threshold: \`${result.critical_gb} GB\``,
    `- Verdict: \`${result.status}\``,
    '',
    '## Notes',
    '',
    ...result.notes.map((note) => `- ${note}`),
    '',
  ];
  fs.writeFileSync(path.join(SNAPSHOT_DIR, 'summary.md'), summary.join('\n'));
}

async function main() {
  const generatedAt = new Date().toISOString();
  const now = new Date(generatedAt);
  const info = getDiskSpaceInfo();
  const state = readState();

  if (!info) {
    const failed = {
      generated_at: generatedAt,
      status: 'ERROR',
      filesystem: FILESYSTEM_LABEL,
      mount_path: MOUNT_PATH,
      free_gb: 0,
      warn_gb: formatGb(WARN_BYTES),
      critical_gb: formatGb(CRITICAL_BYTES),
      notes: ['Failed to read disk space via df'],
    };
    writeSnapshot(failed, state);
    console.log(JSON.stringify(failed, null, 2));
    process.exit(3);
  }

  const freeBytes = info.availableBytes;
  const freeGb = formatGb(freeBytes);
  let status = 'PASS';
  let severity = null;
  const notes = [
    `Filesystem ${info.filesystem} mounted at ${info.mountPoint}`,
    `${freeGb} GB free (${info.usePercent}% used)`,
  ];

  if (freeBytes <= CRITICAL_BYTES) {
    status = 'CRITICAL';
    severity = 'critical';
    notes.push(`Below critical threshold of ${formatGb(CRITICAL_BYTES)} GB`);
  } else if (freeBytes <= WARN_BYTES) {
    status = 'WARN';
    severity = 'warning';
    notes.push(`Below warning threshold of ${formatGb(WARN_BYTES)} GB`);
  } else {
    notes.push('Disk space healthy');
  }

  let incidentCreated = false;
  if (severity && shouldAlert(severity, state, now)) {
    const title = severity === 'critical'
      ? buildIncidentTitle(freeBytes)
      : `[WARN] ${FILESYSTEM_LABEL} disk below ${formatGb(WARN_BYTES)} GB — ${freeGb} GB free`;
    const description = [
      '## Disk Space Alert',
      '',
      `- Severity: \`${severity.toUpperCase()}\``,
      `- Filesystem: \`${info.filesystem}\``,
      `- Mount path: \`${info.mountPoint}\``,
      `- Free space: \`${freeGb} GB\``,
      `- Used: \`${info.usePercent}%\``,
      `- Routine: \`${ROUTINE_IDENTIFIER}\``,
      `- Execution issue: \`${EXECUTION_ISSUE}\``,
    ].join('\n');
    const created = await createIncident(
      title,
      description,
      severity === 'critical' ? 'critical' : 'high',
      severity === 'critical' ? 'todo' : 'backlog'
    );
    incidentCreated = Boolean(created);
    if (incidentCreated) {
      if (severity === 'critical') state.lastCriticalAlertAt = generatedAt;
      else state.lastWarningAlertAt = generatedAt;
      notes.push(`Created ${severity} incident`);
    } else {
      notes.push(`Did not create ${severity} incident`);
    }
  }

  writeState(state);
  const result = {
    generated_at: generatedAt,
    status,
    filesystem: info.filesystem,
    mount_path: info.mountPoint,
    free_gb: freeGb,
    size_bytes: info.sizeBytes,
    available_bytes: freeBytes,
    warn_gb: formatGb(WARN_BYTES),
    critical_gb: formatGb(CRITICAL_BYTES),
    incident_created: incidentCreated,
    notes,
  };
  writeSnapshot(result, state);
  console.log(JSON.stringify(result, null, 2));
  process.exit(status === 'PASS' ? 0 : status === 'WARN' ? 1 : 2);
}

module.exports = {
  buildIncidentTitle,
  matchesOpenIncidentTitle,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(3);
  });
}
