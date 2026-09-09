import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const distPath = join(dirname(fileURLToPath(import.meta.url)), '../dist/lib/oauthStubs.js');

describe('oauth M1 stubs', { skip: !existsSync(distPath) && 'dist not built yet' }, () => {
  const { buildRegisterStub, buildTokenStub, OAUTH_SCOPES } = require('../dist/lib/oauthStubs');
  it('register stub carries the M2 contract', () => {
    const p = buildRegisterStub();
    assert.equal(p.error, 'not_implemented');
    assert.ok(p.design.includes('oauth-design.md'));
    assert.deepEqual(p.contract.request.scopes, [...OAUTH_SCOPES]);
  });
  it('token stub advertises OAuth 2.1 grants only (no implicit/password)', () => {
    const p = buildTokenStub();
    const grants = p.contract.grant_types;
    assert.ok(grants.includes('client_credentials'));
    assert.ok(!grants.includes('implicit'));
    assert.ok(!grants.includes('password'));
  });
});
