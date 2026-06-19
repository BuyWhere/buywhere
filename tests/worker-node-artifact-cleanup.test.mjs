import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();

describe('buy-53114 worker cleanup', () => {
  it('removes stale wc cycle cleanup logs but keeps fresh ones', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-cleanup-'));
    const workspacesRoot = path.join(tmpRoot, 'workspaces');
    const workspaceDir = path.join(workspacesRoot, 'ws-1');
    const logsDir = path.join(workspaceDir, 'logs');
    const dataDir = path.join(workspaceDir, 'data');
    const reportPath = path.join(tmpRoot, 'report.json');
    const scriptPath = path.join(repoRoot, 'scripts/buy-53114-worker-node-artifact-cleanup.sh');
    const staleLog = path.join(logsDir, 'buy53489_wc_cycle_cleanup.log');
    const freshLog = path.join(logsDir, 'buy53523_wc_cycle_cleanup.log');
    const staleJsonlLog = path.join(logsDir, 'wc_cycle_cleanup.jsonl');
    const staleReport = path.join(dataDir, '_wc_cleanup_report.json');
    const freshReport = path.join(dataDir, '_wc_cleanup_report.fresh.json');
    const now = new Date();
    const staleTime = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(staleLog, 'stale log\n');
    fs.writeFileSync(freshLog, 'fresh log\n');
    fs.writeFileSync(staleJsonlLog, '{"moved_count":1}\n');
    fs.writeFileSync(staleReport, '{"alert_required":0}\n');
    fs.writeFileSync(freshReport, '{"alert_required":0}\n');
    fs.utimesSync(staleLog, staleTime, staleTime);
    fs.utimesSync(staleJsonlLog, staleTime, staleTime);
    fs.utimesSync(staleReport, staleTime, staleTime);

    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        WORKSPACES_ROOT: workspacesRoot,
        APPLY: '1',
        LOG_RETENTION_DAYS: '2',
        REPORT_PATH: reportPath,
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `cleanup script failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.equal(fs.existsSync(staleLog), false, 'expected stale wc cycle cleanup log to be removed');
    assert.equal(fs.existsSync(freshLog), true, 'expected fresh wc cycle cleanup log to be kept');
    assert.equal(fs.existsSync(staleJsonlLog), false, 'expected stale wc cycle cleanup jsonl log to be removed');
    assert.equal(fs.existsSync(staleReport), false, 'expected stale wc cycle cleanup report to be removed');
    assert.equal(fs.existsSync(freshReport), true, 'expected unrelated fresh data file to be kept');

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.removed_count, 3);
    assert.equal(report.failed_count, 0);
  });

  it('removes stale disk watchdog snapshots but keeps fresh ones', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-cleanup-disk-watchdog-'));
    const workspacesRoot = path.join(tmpRoot, 'workspaces');
    const workspaceDir = path.join(workspacesRoot, 'ws-1');
    const dataDir = path.join(workspaceDir, 'data');
    const reportPath = path.join(tmpRoot, 'report.json');
    const scriptPath = path.join(repoRoot, 'scripts/buy-53114-worker-node-artifact-cleanup.sh');
    const staleSnapshotDir = path.join(dataDir, 'buy-53541-disk-watchdog-20260619T114323Z');
    const freshSnapshotDir = path.join(dataDir, 'buy-53580-disk-watchdog-20260619T131620Z');
    const now = new Date();
    const staleTime = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    fs.mkdirSync(staleSnapshotDir, { recursive: true });
    fs.mkdirSync(freshSnapshotDir, { recursive: true });
    fs.writeFileSync(path.join(staleSnapshotDir, 'result.json'), '{"status":"PASS"}\n');
    fs.writeFileSync(path.join(freshSnapshotDir, 'result.json'), '{"status":"PASS"}\n');
    fs.utimesSync(staleSnapshotDir, staleTime, staleTime);
    fs.utimesSync(path.join(staleSnapshotDir, 'result.json'), staleTime, staleTime);

    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        WORKSPACES_ROOT: workspacesRoot,
        APPLY: '1',
        DISK_ARTIFACT_RETENTION_DAYS: '2',
        REPORT_PATH: reportPath,
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `cleanup script failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.equal(fs.existsSync(staleSnapshotDir), false, 'expected stale disk watchdog snapshot to be removed');
    assert.equal(fs.existsSync(freshSnapshotDir), true, 'expected fresh disk watchdog snapshot to be kept');

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.removed_count, 1);
    assert.equal(report.failed_count, 0);
  });

  it('removes stale threshold report artifacts but keeps fresh ones', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-cleanup-threshold-report-'));
    const workspacesRoot = path.join(tmpRoot, 'workspaces');
    const workspaceDir = path.join(workspacesRoot, 'ws-1');
    const reportsDir = path.join(workspaceDir, 'reports');
    const reportPath = path.join(tmpRoot, 'report.json');
    const scriptPath = path.join(repoRoot, 'scripts/buy-53114-worker-node-artifact-cleanup.sh');
    const staleThresholdReport = path.join(
      reportsDir,
      'BUY-53277-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup-threshold.json',
    );
    const freshThresholdReport = path.join(
      reportsDir,
      'BUY-53598-worker-node-disk-space-enforcement-wc-cycle-artifact-cleanup-threshold.json',
    );
    const now = new Date();
    const staleTime = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(staleThresholdReport, '{"alert_required":1}\n');
    fs.writeFileSync(freshThresholdReport, '{"alert_required":0}\n');
    fs.utimesSync(staleThresholdReport, staleTime, staleTime);

    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        WORKSPACES_ROOT: workspacesRoot,
        APPLY: '1',
        DISK_ARTIFACT_RETENTION_DAYS: '2',
        REPORT_PATH: reportPath,
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `cleanup script failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.equal(fs.existsSync(staleThresholdReport), false, 'expected stale threshold report to be removed');
    assert.equal(fs.existsSync(freshThresholdReport), true, 'expected fresh threshold report to be kept');

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.removed_count, 1);
    assert.equal(report.failed_count, 0);
  });

  it('removes stale safe-data cleanup dry-run artifacts but keeps fresh ones', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-cleanup-safe-data-'));
    const workspacesRoot = path.join(tmpRoot, 'workspaces');
    const workspaceDir = path.join(workspacesRoot, 'ws-1');
    const reportsDir = path.join(workspaceDir, 'reports');
    const reportPath = path.join(tmpRoot, 'report.json');
    const scriptPath = path.join(repoRoot, 'scripts/buy-53114-worker-node-artifact-cleanup.sh');
    const staleDryrunLog = path.join(reportsDir, 'BUY-53685-0ed653ab-62ba-4deb-8348-3086ab46961c-dryrun.log');
    const freshDryrunLog = path.join(reportsDir, 'BUY-53718-0ed653ab-62ba-4deb-8348-3086ab46961c-dryrun.log');
    const staleSummary = path.join(reportsDir, 'BUY-53685-dryrun-summary.tsv');
    const freshSummary = path.join(reportsDir, 'BUY-53718-dryrun-summary.tsv');
    const staleSweep = path.join(reportsDir, 'BUY-53685-safe-data-cleanup-sweep.md');
    const freshSweep = path.join(reportsDir, 'BUY-53718-safe-data-cleanup-sweep.md');
    const now = new Date();
    const staleTime = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(staleDryrunLog, 'dry-run stale\n');
    fs.writeFileSync(freshDryrunLog, 'dry-run fresh\n');
    fs.writeFileSync(staleSummary, 'workspace\tstatus\n');
    fs.writeFileSync(freshSummary, 'workspace\tstatus\n');
    fs.writeFileSync(staleSweep, '# stale\n');
    fs.writeFileSync(freshSweep, '# fresh\n');
    fs.utimesSync(staleDryrunLog, staleTime, staleTime);
    fs.utimesSync(staleSummary, staleTime, staleTime);
    fs.utimesSync(staleSweep, staleTime, staleTime);

    const result = spawnSync('bash', [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        WORKSPACES_ROOT: workspacesRoot,
        APPLY: '1',
        DISK_ARTIFACT_RETENTION_DAYS: '2',
        REPORT_PATH: reportPath,
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `cleanup script failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.equal(fs.existsSync(staleDryrunLog), false, 'expected stale dry-run log to be removed');
    assert.equal(fs.existsSync(freshDryrunLog), true, 'expected fresh dry-run log to be kept');
    assert.equal(fs.existsSync(staleSummary), false, 'expected stale dry-run summary to be removed');
    assert.equal(fs.existsSync(freshSummary), true, 'expected fresh dry-run summary to be kept');
    assert.equal(fs.existsSync(staleSweep), false, 'expected stale dry-run sweep report to be removed');
    assert.equal(fs.existsSync(freshSweep), true, 'expected fresh dry-run sweep report to be kept');

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.removed_count, 3);
    assert.equal(report.failed_count, 0);
  });
});
