import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  WARN_THRESHOLD_GB,
  CRITICAL_THRESHOLD_GB,
  checkDiskSpaceThresholds,
} = require('../dist/monitoring/diskSpace.js');

const gib = 1024 * 1024 * 1024;

describe('diskSpace thresholds', () => {
  it('uses a 20GB warning threshold', async () => {
    assert.equal(WARN_THRESHOLD_GB, 20);

    const alert = await checkDiskSpaceThresholds({
      filesystem: '/dev/vda1',
      size: 200 * gib,
      used: 176.6 * gib,
      available: 19.4 * gib,
      usePercent: 88,
      mountPoint: '/',
    });

    assert.deepEqual(alert && alert.severity, 'warning');
    assert.deepEqual(alert && alert.thresholdGb, 20);
    assert.deepEqual(alert && alert.availableGb, 19.4);
  });

  it('keeps the 5GB critical threshold', async () => {
    assert.equal(CRITICAL_THRESHOLD_GB, 5);

    const alert = await checkDiskSpaceThresholds({
      filesystem: '/dev/vda1',
      size: 200 * gib,
      used: 195.5 * gib,
      available: 4.5 * gib,
      usePercent: 98,
      mountPoint: '/',
    });

    assert.deepEqual(alert && alert.severity, 'critical');
    assert.deepEqual(alert && alert.thresholdGb, 5);
    assert.deepEqual(alert && alert.availableGb, 4.5);
  });

  it('treats space above 20GB as healthy', async () => {
    const alert = await checkDiskSpaceThresholds({
      filesystem: '/dev/vda1',
      size: 200 * gib,
      used: 173.9 * gib,
      available: 21.1 * gib,
      usePercent: 87,
      mountPoint: '/',
    });

    assert.equal(alert, null);
  });
});
