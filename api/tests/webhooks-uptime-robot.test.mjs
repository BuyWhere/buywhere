// BUY-57443: Phantom UptimeRobot monitor IDs (e.g. 999999 from an external
// account) must be rejected with HTTP 202 and must NOT call createPaperclipIssue.
//
// Standalone script — runs against the compiled dist using an in-process Express
// server. Localhost calls use Node's http module; Paperclip API calls are mocked.

import http from 'http';
import https from 'https';
import express from 'express';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Configure BEFORE requiring the router
process.env.UPTIMEROBOT_WEBHOOK_RELAY_URL = 'https://paperclip.example.test';
process.env.UPTIMEROBOT_WEBHOOK_RELAY_API_KEY = 'test-key';

// Stub Redis and DB
const config = require('../dist/config');
config.redis.set = async () => 'OK';
config.redis.get = async () => null;
config.redis.disconnect = () => {};
config.redis.on = () => {};
config.db.query = async () => ({ rows: [] });
config.db.connect = async () => ({ query: async () => ({ rows: [] }), release: () => {} });
config.db.end = () => {};

// Capture Paperclip API calls; route all other fetch calls (including localhost)
// through Node's http/https modules so the in-process Express server is reachable.
const paperclipCalls = [];

globalThis.fetch = async (url, opts) => {
  const urlStr = String(url);
  // Paperclip domains → mock response
  if (urlStr.includes('paperclip.example.test') || urlStr.includes('paperclip.com')) {
    paperclipCalls.push({ url: urlStr, method: opts?.method });
    return { ok: true, status: 201, text: async () => '{"id":"new-issue"}', json: async () => ({ id: 'new-issue' }) };
  }
  // All other URLs → use real http/https module
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const mod = urlObj.protocol === 'https:' ? https : http;
    const reqOpts = { method: opts?.method || 'GET', headers: opts?.headers || {} };
    const req = mod.request(urlObj, reqOpts, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        text: async () => body,
        json: async () => JSON.parse(body),
      }));
    });
    req.on('error', reject);
    if (opts?.body) req.write(opts.body);
    req.end();
  });
};

const webhooksRouter = require('../dist/routes/webhooks').default;

const app = express();
app.use(express.json());
app.get('/probe', (req, res) => res.json({ ok: true }));
app.use('/api', webhooksRouter);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}/api/uptime-robot`;

// Verify server is reachable
{
  const r = await globalThis.fetch(`http://127.0.0.1:${port}/probe`);
  const body = await r.text();
  console.log('[server-probe] status=' + r.status + ' body=' + body);
}

const post = (body) =>
  globalThis.fetch(baseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

let passed = 0;
let failed = 0;

function assert(condition, actual, expected, msg) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.error('  FAIL: ' + msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

console.log('\nBUY-57443: monitor-ID allowlist tests\n');

console.log('[1] Phantom monitor ID 999999 — should return 202 + reason=unknown_monitor_id');
{
  paperclipCalls.length = 0;
  const before = paperclipCalls.length;
  const r = await post({ monitorID: 999999, monitorURL: 'https://x', alertType: 1, alertDetails: 'phantom down' });
  const body = await r.json();
  assert(r.status === 202, r.status, 202, 'HTTP 202');
  assert(body.received === true, body.received, true, 'received=true');
  assert(body.ignored === true, body.ignored, true, 'ignored=true');
  assert(body.reason === 'unknown_monitor_id', body.reason, 'unknown_monitor_id', 'reason=unknown_monitor_id');
  assert(paperclipCalls.length === before, paperclipCalls.length, before, 'createPaperclipIssue NOT called');
}

console.log('\n[2] Phantom ID + BuyWhere-looking URL (spoof defense)');
{
  paperclipCalls.length = 0;
  const before = paperclipCalls.length;
  const r = await post({ monitorID: '1234567890', monitorURL: 'https://api.buywhere.ai/health', alertType: 1 });
  const body = await r.json();
  assert(r.status === 202, r.status, 202, 'HTTP 202');
  assert(body.reason === 'unknown_monitor_id', body.reason, 'unknown_monitor_id', 'reason=unknown_monitor_id');
  assert(paperclipCalls.length === before, paperclipCalls.length, before, 'createPaperclipIssue NOT called');
}

console.log('\n[3] Allowlisted ID + unsupported host (2nd line of defense)');
{
  paperclipCalls.length = 0;
  const before = paperclipCalls.length;
  const r = await post({ monitorID: '802985723', monitorURL: 'https://evil.example.com', alertType: 1 });
  const body = await r.json();
  assert(r.status === 202, r.status, 202, 'HTTP 202');
  assert(body.reason === 'unsupported_monitor_host', body.reason, 'unsupported_monitor_host', 'reason=unsupported_monitor_host');
  assert(paperclipCalls.length === before, paperclipCalls.length, before, 'createPaperclipIssue NOT called');
}

console.log('\n[4] Allowlisted ID + BuyWhere host — reaches Paperclip');
{
  paperclipCalls.length = 0;
  const before = paperclipCalls.length;
  const r = await post({ monitorID: '802985723', monitorURL: 'https://api.buywhere.ai/health', alertType: 1, alertDetails: '2026-06-25T12:00:00Z' });
  assert([200, 201].includes(r.status), r.status, '200|201', 'HTTP 200 or 201');
  assert(paperclipCalls.length > before, paperclipCalls.length, before + 1, 'createPaperclipIssue called');
}

console.log('\n' + '-'.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');

server.close();
process.exit(failed > 0 ? 1 : 0);
