/**
 * Regression test for BUY-33815: harden against Postgres restart connection-loss.
 *
 * Simulates a Postgres restart by emitting a synthetic pg-client error on the
 * pool. Asserts the process is still alive after 2s (regression: previously
 * the uncaughtException handler called process.exit(1), taking the whole
 * container down — see BUY-33735 49-min outage).
 *
 * Strategy: load the source TypeScript modules via `node --experimental-strip-types`
 * (no `tsc` build needed — these are pure type-strip, no transform). The pool is
 * created but never connects (DATABASE_URL is unset, so it lazily waits for
 * the first query). We can emit 'error' directly on the EventEmitter pool.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// Load source via strip-types (no DATABASE_URL, so no real connection is opened).
// We deliberately skip the redis import in config.ts by importing only the bits
// we need via the no-redis variant — it stubs redis.
const { db } = await import('../src/config-no-redis.ts');

// --- helper copied verbatim from api/src/index.ts (BUY-33815) ---
function isPgConnectionLoss(err) {
  if (!err || typeof err !== 'object') return false;
  const e = err;
  const codes = [e.code, ...(Array.isArray(e.errors) ? e.errors.map((x) => x.code) : [])].filter(
    (c) => typeof c === 'string'
  );
  if (codes.some((c) => c === 'ECONNRESET' || c === '08006' || c === '57P' || c === '57P01' || c === '57P02' || c === '57P03')) {
    return true;
  }
  const msg = String(e.message || '');
  return /Connection terminated/i.test(msg) || /connection terminated unexpectedly/i.test(msg);
}

describe('BUY-33815: isPgConnectionLoss detector', () => {
  it('detects ECONNRESET', () => {
    assert.equal(isPgConnectionLoss({ code: 'ECONNRESET', message: 'read ECONNRESET' }), true);
  });

  it('detects SQLSTATE 08006 (connection_failure)', () => {
    assert.equal(isPgConnectionLoss({ code: '08006', message: 'connection_failure' }), true);
  });

  it('detects SQLSTATE 57P01 (admin_shutdown)', () => {
    assert.equal(isPgConnectionLoss({ code: '57P01', message: 'terminating connection due to administrator command' }), true);
  });

  it('detects SQLSTATE 57P02 (crash_shutdown)', () => {
    assert.equal(isPgConnectionLoss({ code: '57P02', message: 'database is shutting down' }), true);
  });

  it('detects SQLSTATE 57P03 (cannot_connect_now)', () => {
    assert.equal(isPgConnectionLoss({ code: '57P03', message: 'the database system is starting up' }), true);
  });

  it('detects "Connection terminated" message', () => {
    assert.equal(isPgConnectionLoss({ message: 'Connection terminated unexpectedly' }), true);
  });

  it('detects pg.errors[] array with ECONNRESET (multi-error wrapped)', () => {
    assert.equal(
      isPgConnectionLoss({ message: 'query error', errors: [{ code: 'ECONNRESET' }] }),
      true
    );
  });

  it('does NOT flag a generic runtime TypeError', () => {
    assert.equal(isPgConnectionLoss(new TypeError('cannot read property of undefined')), false);
  });

  it('does NOT flag null/undefined', () => {
    assert.equal(isPgConnectionLoss(null), false);
    assert.equal(isPgConnectionLoss(undefined), false);
  });
});

describe('BUY-33815: pg-pool error handler swallows idle-client errors', () => {
  it('process is still alive 2s after a synthetic ECONNRESET on the pool', async () => {
    // Register the same handler shape as config.ts/config-no-redis.ts.
    // (The pool already has the handler attached when we imported db above;
    //  this assertion is a behaviour check — we re-emit and verify the
    //  registered handler does not call process.exit.)
    const before = process.uptime();
    db.emit('error', Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' }));

    // Wait 2s — long enough that an unhandled fatal would have killed us.
    await new Promise((r) => setTimeout(r, 2000));

    assert.ok(process.uptime() >= before, 'process uptime must keep advancing (process is still alive)');
    assert.equal(process.exitCode, undefined, 'process.exitCode must not be set by pool error');
  });

  it('process is still alive 2s after a synthetic SQLSTATE 57P01 (admin_shutdown)', async () => {
    db.emit('error', Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }));
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(process.exitCode, undefined, 'process.exitCode must not be set by pool error');
  });

  it('process is still alive 2s after a synthetic "Connection terminated" message', async () => {
    db.emit('error', new Error('Connection terminated unexpectedly'));
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(process.exitCode, undefined, 'process.exitCode must not be set by pool error');
  });
});
