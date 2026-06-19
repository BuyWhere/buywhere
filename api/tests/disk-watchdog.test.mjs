import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const {
  buildWatchdogEnv,
  resolveWatchdogEntrypointPathForTests,
} = require('../dist/jobs/diskSpaceWatchdog');
const {
  buildIncidentTitle,
  matchesOpenIncidentTitle,
} = require('../../scripts/buy-38913-disk-space-watchdog.cjs');
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../..');

describe('diskSpaceWatchdog buildWatchdogEnv', () => {
  it('does not force DISK_MOUNT_PATH when unset', () => {
    const previous = process.env.DISK_MOUNT_PATH;
    delete process.env.DISK_MOUNT_PATH;

    try {
      const env = buildWatchdogEnv();
      assert.equal(Object.prototype.hasOwnProperty.call(env, 'DISK_MOUNT_PATH'), false);
    } finally {
      if (previous === undefined) delete process.env.DISK_MOUNT_PATH;
      else process.env.DISK_MOUNT_PATH = previous;
    }
  });

  it('preserves an explicit DISK_MOUNT_PATH override', () => {
    const previous = process.env.DISK_MOUNT_PATH;
    process.env.DISK_MOUNT_PATH = '/var/lib/railway';

    try {
      const env = buildWatchdogEnv();
      assert.equal(env.DISK_MOUNT_PATH, '/var/lib/railway');
    } finally {
      if (previous === undefined) delete process.env.DISK_MOUNT_PATH;
      else process.env.DISK_MOUNT_PATH = previous;
    }
  });

  it('defaults the state file to the BUY-48198 path', () => {
    const previous = process.env.DISK_STATE_FILE;
    delete process.env.DISK_STATE_FILE;

    try {
      const env = buildWatchdogEnv();
      assert.equal(env.DISK_STATE_FILE, '/tmp/buy-48198-disk-state.json');
    } finally {
      if (previous === undefined) delete process.env.DISK_STATE_FILE;
      else process.env.DISK_STATE_FILE = previous;
    }
  });

  it('defaults the warning threshold to 20GB', () => {
    const previous = process.env.DISK_WARN_BYTES;
    delete process.env.DISK_WARN_BYTES;

    try {
      const env = buildWatchdogEnv();
      assert.equal(env.DISK_WARN_BYTES, String(20 * 1024 * 1024 * 1024));
    } finally {
      if (previous === undefined) delete process.env.DISK_WARN_BYTES;
      else process.env.DISK_WARN_BYTES = previous;
    }
  });

  it('prefers the canonical BUY-48198 cron wrapper over legacy aliases when resolving fallbacks', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-watchdog-entrypoint-'));
    const scriptsDir = path.join(tmpRoot, 'scripts');
    const tempDistDir = path.join(tmpRoot, 'api', 'dist', 'jobs');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(tempDistDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, 'run-buy-48198-disk-watchdog-cron.sh'), '#!/usr/bin/env bash\n');
    fs.copyFileSync(
      path.join(repoRoot, 'api/dist/jobs/diskSpaceWatchdog.js'),
      path.join(tempDistDir, 'diskSpaceWatchdog.js')
    );

    const probeCode = `
      process.chdir(${JSON.stringify(tmpRoot)});
      const { resolveWatchdogEntrypointPathForTests } = require(${JSON.stringify(
        path.join(tempDistDir, 'diskSpaceWatchdog.js')
      )});
      process.stdout.write(resolveWatchdogEntrypointPathForTests());
    `;

    const result = spawnSync(process.execPath, ['-e', probeCode], {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, path.join(tmpRoot, 'scripts', 'run-buy-48198-disk-watchdog-cron.sh'));
  });

  it('creates missing parent directories for custom state and snapshot paths', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-watchdog-'));
    const stateFile = path.join(tmpRoot, 'nested', 'state', 'watchdog-state.json');
    const snapshotDir = path.join(tmpRoot, 'nested', 'snapshot');
    const scriptPath = path.join(repoRoot, 'scripts/buy-38913-disk-space-watchdog.cjs');
    const executionIssue = 'BUY-53519';

    const result = spawnSync('node', [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DISK_STATE_FILE: stateFile,
        DISK_SNAPSHOT_DIR: snapshotDir,
        DISK_EXECUTION_ISSUE: executionIssue,
        DISK_FILESYSTEM_LABEL: '/',
        DISK_MOUNT_PATH: '/',
        DISK_WARN_BYTES: '1',
        DISK_CRITICAL_BYTES: '0',
      },
      encoding: 'utf8',
    });

    assert.notEqual(
      result.status,
      3,
      `watchdog should not fail on missing directories\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    assert.equal(fs.existsSync(stateFile), true, 'expected state file to be created');
    assert.equal(fs.existsSync(path.join(snapshotDir, 'result.json')), true, 'expected snapshot result.json');
    assert.equal(fs.existsSync(path.join(snapshotDir, 'state.json')), true, 'expected snapshot state.json');
    const summary = fs.readFileSync(path.join(snapshotDir, 'summary.md'), 'utf8');
    assert.match(summary, new RegExp(`^# ${executionIssue} Disk Space Watchdog`, 'm'));
    assert.match(summary, /- Routine: `BUY-48198`/);
    assert.match(summary, new RegExp(`- Execution issue: \`${executionIssue}\``));
  });
});

describe('buy-38913 disk watchdog incident title helpers', () => {
  it('builds the incident title from the configured filesystem label', () => {
    assert.equal(buildIncidentTitle(4.5 * 1024 * 1024 * 1024), '[INCIDENT] /dev/vda1 disk below 5 GB — 4.5 GB free');
  });

  it('matches only incident titles for the configured filesystem label', () => {
    assert.equal(matchesOpenIncidentTitle('[INCIDENT] /dev/vda1 disk below 5 GB — 4.5 GB free'), true);
    assert.equal(matchesOpenIncidentTitle('[INCIDENT] / disk below 5 GB — 4.5 GB free'), false);
  });
});

describe('run-buy-48198-disk-watchdog-cron wrapper', () => {
  it('runs both cleanup stages before the watchdog and tolerates cleanup alert rc=10', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-watchdog-cron-wrapper-'));
    const scriptsDir = path.join(tmpRoot, 'scripts');
    const logsDir = path.join(tmpRoot, 'logs');
    const orderFile = path.join(tmpRoot, 'order.log');
    const cronLog = path.join(logsDir, 'cron.log');

    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.copyFileSync(
      path.join(repoRoot, 'scripts/run-buy-48198-disk-watchdog-cron.sh'),
      path.join(scriptsDir, 'run-buy-48198-disk-watchdog-cron.sh')
    );
    fs.writeFileSync(
      path.join(scriptsDir, 'wc-cycle-cleanup.sh'),
      `#!/usr/bin/env bash
set -euo pipefail
echo wc-cleanup >> ${JSON.stringify(orderFile)}
exit 0
`
    );
    fs.writeFileSync(
      path.join(scriptsDir, 'buy-53114-worker-node-artifact-cleanup.sh'),
      `#!/usr/bin/env bash
set -euo pipefail
echo worker-cleanup >> ${JSON.stringify(orderFile)}
exit 10
`
    );
    fs.writeFileSync(
      path.join(scriptsDir, 'run-buy-48198-disk-watchdog.sh'),
      `#!/usr/bin/env bash
set -euo pipefail
echo watchdog >> ${JSON.stringify(orderFile)}
exit 0
`
    );
    fs.chmodSync(path.join(scriptsDir, 'wc-cycle-cleanup.sh'), 0o755);
    fs.chmodSync(path.join(scriptsDir, 'buy-53114-worker-node-artifact-cleanup.sh'), 0o755);
    fs.chmodSync(path.join(scriptsDir, 'run-buy-48198-disk-watchdog.sh'), 0o755);

    const result = spawnSync('bash', [path.join(scriptsDir, 'run-buy-48198-disk-watchdog-cron.sh')], {
      cwd: tmpRoot,
      env: {
        ...process.env,
        LOG_FILE: cronLog,
        WORKSPACES_ROOT: path.join(tmpRoot, 'workspaces'),
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `cron wrapper failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.equal(fs.readFileSync(orderFile, 'utf8'), 'wc-cleanup\nworker-cleanup\nwatchdog\n');

    const log = fs.readFileSync(cronLog, 'utf8');
    assert.match(log, /watchdog start/);
    assert.match(log, /wc cleanup completed rc=0/);
    assert.match(log, /worker artifact cleanup completed rc=10 \(disk threshold still exceeded after cleanup; continuing\)/);
    assert.match(log, /watchdog complete rc=0/);
  });
});

describe('setup-buy-48198-disk-watchdog installer', () => {
  it('installs a canonical 5-minute cron entry, removes legacy aliases, and runs an immediate smoke pass', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-watchdog-setup-'));
    const scriptsDir = path.join(tmpRoot, 'scripts');
    const fakeBinDir = path.join(tmpRoot, 'fake-bin');
    const logsDir = path.join(tmpRoot, 'logs');
    const cronStateFile = path.join(tmpRoot, 'crontab.txt');
    const smokeFile = path.join(tmpRoot, 'smoke.log');

    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(fakeBinDir, { recursive: true });
    fs.writeFileSync(
      cronStateFile,
      [
        '# existing unrelated cron',
        '* * * * * echo keep-me',
        '# BUY-48198: Disk watchdog + cleanup pipeline - old alias',
        '*/5 * * * * cd /old/repo && bash /old/repo/scripts/run-buy-52997-disk-watchdog-cron.sh',
        '',
      ].join('\n')
    );

    fs.copyFileSync(
      path.join(repoRoot, 'scripts/setup-buy-48198-disk-watchdog.sh'),
      path.join(scriptsDir, 'setup-buy-48198-disk-watchdog.sh')
    );
    fs.writeFileSync(
      path.join(scriptsDir, 'run-buy-48198-disk-watchdog-cron.sh'),
      `#!/usr/bin/env bash
set -euo pipefail
mkdir -p ${JSON.stringify(logsDir)}
printf 'smoke:%s:%s\\n' "\${WORKSPACES_ROOT:-}" "\${LOG_FILE:-}" >> ${JSON.stringify(smokeFile)}
`
    );
    fs.chmodSync(path.join(scriptsDir, 'run-buy-48198-disk-watchdog-cron.sh'), 0o755);

    fs.writeFileSync(
      path.join(fakeBinDir, 'crontab'),
      `#!/usr/bin/env bash
set -euo pipefail
state_file=${JSON.stringify(cronStateFile)}
if [[ "\${1:-}" == "-l" ]]; then
  if [[ -f "$state_file" ]]; then
    cat "$state_file"
    exit 0
  fi
  exit 1
fi
cat > "$state_file"
`
    );
    fs.chmodSync(path.join(fakeBinDir, 'crontab'), 0o755);

    const result = spawnSync('bash', [path.join(scriptsDir, 'setup-buy-48198-disk-watchdog.sh')], {
      cwd: tmpRoot,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH}`,
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `setup script failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

    const installedCrontab = fs.readFileSync(cronStateFile, 'utf8');
    assert.match(installedCrontab, /^\*\/5 \* \* \* \* cd .*scripts\/run-buy-48198-disk-watchdog-cron\.sh$/m);
    assert.doesNotMatch(installedCrontab, /run-buy-52997-disk-watchdog-cron\.sh/);
    assert.match(installedCrontab, /^\* \* \* \* \* echo keep-me$/m);

    const smoke = fs.readFileSync(smokeFile, 'utf8');
    assert.match(smoke, /^smoke:/m);
    assert.equal(fs.existsSync(logsDir), true, 'expected setup script to create the logs directory');
    assert.match(result.stdout, /BUY-48198 cron installed:/);
    assert.match(result.stdout, /Running immediate watchdog smoke pass/);
    assert.match(result.stdout, /Setup complete\./);
  });
});
