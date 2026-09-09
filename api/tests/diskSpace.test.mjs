import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getDiskSpaceInfo, checkDiskSpaceThresholds, WARN_THRESHOLD_GB, CRITICAL_THRESHOLD_GB } = require('../dist/monitoring/diskSpace');

describe('diskSpace', () => {
  it('checks disk space and returns usage info', async () => {
    const info = await getDiskSpaceInfo();
    if (!info) {
      console.warn('[test] getDiskSpaceInfo returned null (skip — not running on Linux with df)');
      return;
    }
    assert.ok(info.filesystem);
    assert.ok(typeof info.used === 'number');
    assert.ok(typeof info.available === 'number');
    assert.ok(typeof info.size === 'number');
    assert.ok(typeof info.usePercent === 'number');
    assert.ok(info.mountPoint);
  });

  it('returns null alert when disk space is above thresholds', async () => {
    const mockInfo = {
      filesystem: '/dev/vda1',
      size: 100 * 1024 * 1024 * 1024,
      used: 60 * 1024 * 1024 * 1024,
      available: 40 * 1024 * 1024 * 1024,
      usePercent: 60,
      mountPoint: '/',
    };
    const alert = await checkDiskSpaceThresholds(mockInfo);
    assert.strictEqual(alert, null, 'Should not alert when above thresholds');
  });

  it('returns warning alert when below threshold', async () => {
    const mockInfo = {
      filesystem: '/dev/vda1',
      size: 100 * 1024 * 1024 * 1024,
      used: 85 * 1024 * 1024 * 1024,
      available: 15 * 1024 * 1024 * 1024,
      usePercent: 85,
      mountPoint: '/',
    };
    const alert = await checkDiskSpaceThresholds(mockInfo);
    assert.ok(alert, 'Should return alert when below warning threshold');
    assert.strictEqual(alert.severity, 'warning');
    assert.ok(alert.availableGb <= 20);
  });

  it('returns critical alert when below threshold', async () => {
    const mockInfo = {
      filesystem: '/dev/vda1',
      size: 100 * 1024 * 1024 * 1024,
      used: 97 * 1024 * 1024 * 1024,
      available: 3 * 1024 * 1024 * 1024,
      usePercent: 97,
      mountPoint: '/',
    };
    const alert = await checkDiskSpaceThresholds(mockInfo);
    assert.ok(alert, 'Should return alert when below critical threshold');
    assert.strictEqual(alert.severity, 'critical');
    assert.ok(alert.availableGb <= 5);
  });
});
