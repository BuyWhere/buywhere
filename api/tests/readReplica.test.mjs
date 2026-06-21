import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { estimateReplicaLagMs } = require('../dist/lib/readReplica');

describe('estimateReplicaLagMs', () => {
  it('returns 0 when receive and replay LSNs match, even if the replay timestamp is stale', () => {
    const lagMs = estimateReplicaLagMs({
      lagSeconds: 5.466,
      receiveLsn: '0/ABCDEF0',
      replayLsn: '0/ABCDEF0',
    });

    assert.equal(lagMs, 0);
  });

  it('uses elapsed replay age when WAL is still behind', () => {
    const lagMs = estimateReplicaLagMs({
      lagSeconds: 0.466,
      receiveLsn: '0/ABCDEF1',
      replayLsn: '0/ABCDEE0',
    });

    assert.equal(lagMs, 466);
  });

  it('returns null when lag cannot be measured and the replica is not caught up', () => {
    const lagMs = estimateReplicaLagMs({
      lagSeconds: null,
      receiveLsn: '0/ABCDEF1',
      replayLsn: '0/ABCDEE0',
    });

    assert.equal(lagMs, null);
  });
});
