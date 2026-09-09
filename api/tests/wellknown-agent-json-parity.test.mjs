/**
 * BUY-75173: A2A surface parity test for api /.well-known/agent.json.
 *
 * Asserts that the rendered api agent card is content-equal (byte-equal except
 * for the optional trailing newline that Express res.json() omits) to the
 * canonical apex source of truth at public/.well-known/agent.json in this
 * repo. Both surfaces are expected to track each other.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { readFileSync } from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('../dist/config');

config.db.end = () => {};
config.redis.on = () => {};
config.redis.disconnect = () => {};

let server;
let port;

before(async () => {
  const { createApp } = require('../dist/server');
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  try { await config.db.end(); } catch {}
  try { config.redis.disconnect(); } catch {}
});

const apexPath = path.resolve(
  process.cwd(),
  '..',
  'public',
  '.well-known',
  'agent.json',
);

async function fetchAgentJson() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/.well-known/agent.json`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

describe('BUY-75173 api /.well-known/agent.json parity', () => {
  it('serves 200 with JSON content-type', async () => {
    const res = await fetchAgentJson();
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'] || '', /json/i);
  });

  it('rendered body content-equals apex public/.well-known/agent.json', async () => {
    const apexBytes = readFileSync(apexPath, 'utf8');
    const apexTrimmed = apexBytes.replace(/\s+$/, '');
    const res = await fetchAgentJson();
    // Express res.json() emits no trailing newline. Strip trailing whitespace
    // from apex so the comparison is content-based, not byte-count-based.
    assert.equal(res.body.replace(/\s+$/, ''), apexTrimmed);
  });

  it('exposes authentication.schemes = [apiKey, oauth2]', async () => {
    const res = await fetchAgentJson();
    const card = JSON.parse(res.body);
    assert.deepEqual(card.authentication?.schemes, ['apiKey', 'oauth2']);
  });

  it('exposes skills with location-aware and cross-storefront entries', async () => {
    const res = await fetchAgentJson();
    const card = JSON.parse(res.body);
    const skillIds = (card.skills || []).map((s) => s.id);
    assert.ok(skillIds.includes('location-aware-shopping'), 'location-aware-shopping present');
    assert.ok(skillIds.includes('cross-storefront-comparison'), 'cross-storefront-comparison present');
    assert.ok(skillIds.includes('product-search'), 'product-search present');
    assert.ok(skillIds.includes('deal-finder'), 'deal-finder present');
  });

  it('exposes protocols.mcp serverUrl at canonical /mcp path', async () => {
    const res = await fetchAgentJson();
    const card = JSON.parse(res.body);
    assert.equal(card.protocols?.mcp?.serverUrl, 'https://api.buywhere.ai/mcp');
    assert.equal(card.protocols?.mcp?.transport, 'streamable-http');
  });

  it('version matches apex', async () => {
    const res = await fetchAgentJson();
    const apex = JSON.parse(readFileSync(apexPath, 'utf8'));
    assert.equal(JSON.parse(res.body).version, apex.version);
  });
});
