/**
 * Unit tests for UptimeRobot webhook shared-secret auth (BUY-29146).
 *
 * The route reads process.env.UPTIMEROBOT_WEBHOOK_SHARED_SECRET at request
 * time, so tests can set/delete it between calls without module-cache tricks.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const webhooksRouter = require('../dist/routes/webhooks.js').default;

const SECRET = 'test-shared-secret-2026';

const app = express();
app.use(express.json());
app.use('/webhooks', webhooksRouter);

let server;

function post(path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }));
    });
    req.on('error', reject);
    if (body != null) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('UptimeRobot webhook auth', () => {
  before(() => new Promise((r) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', r);
  }));

  after(() => new Promise((r) => server.close(r)));

  it('returns 503 when UPTIMEROBOT_WEBHOOK_SHARED_SECRET is not set', async () => {
    delete process.env.UPTIMEROBOT_WEBHOOK_SHARED_SECRET;
    const res = await post('/webhooks/uptime-robot', {}, { alertType: 1 });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'Webhook auth not configured');
  });

  it('returns 401 when no auth header is provided', async () => {
    process.env.UPTIMEROBOT_WEBHOOK_SHARED_SECRET = SECRET;
    const res = await post('/webhooks/uptime-robot', {}, { alertType: 1 });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid webhook secret');
  });

  it('returns 401 when X-UptimeRobot-Secret is wrong', async () => {
    process.env.UPTIMEROBOT_WEBHOOK_SHARED_SECRET = SECRET;
    const res = await post(
      '/webhooks/uptime-robot',
      { 'x-uptimerobot-secret': 'wrong-secret' },
      { alertType: 1 },
    );
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid webhook secret');
  });

  it('returns 401 when Bearer token is wrong', async () => {
    process.env.UPTIMEROBOT_WEBHOOK_SHARED_SECRET = SECRET;
    const res = await post(
      '/webhooks/uptime-robot',
      { Authorization: 'Bearer wrong-secret' },
      { alertType: 1 },
    );
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid webhook secret');
  });

  it('returns 200 with valid X-UptimeRobot-Secret header', async () => {
    process.env.UPTIMEROBOT_WEBHOOK_SHARED_SECRET = SECRET;
    const res = await post(
      '/webhooks/uptime-robot',
      { 'x-uptimerobot-secret': SECRET },
      { alertType: 2, monitorFriendlyName: 'API', monitorURL: 'https://api.buywhere.ai' },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.received, true);
  });

  it('returns 200 with valid Bearer auth header', async () => {
    process.env.UPTIMEROBOT_WEBHOOK_SHARED_SECRET = SECRET;
    const res = await post(
      '/webhooks/uptime-robot',
      { Authorization: `Bearer ${SECRET}` },
      { alertType: 2, monitorFriendlyName: 'API', monitorURL: 'https://api.buywhere.ai' },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.received, true);
  });

  it('prefers X-UptimeRobot-Secret over Authorization when both present', async () => {
    process.env.UPTIMEROBOT_WEBHOOK_SHARED_SECRET = SECRET;
    const res = await post(
      '/webhooks/uptime-robot',
      {
        'x-uptimerobot-secret': SECRET,
        Authorization: 'Bearer wrong-bearer',
      },
      { alertType: 1, monitorFriendlyName: 'API' },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.received, true);
  });
});
