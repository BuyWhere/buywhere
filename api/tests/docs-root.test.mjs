import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let server;
let port;

before(async () => {
  const docsRouter = require('../dist/routes/docs').default;

  const app = express();
  app.use('/docs', docsRouter);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  port = server.address().port;
});

after(() => {
  server?.close();
});

describe('docs root', () => {
  it('GET /docs returns 200 and discovery headers', async () => {
    const res = await fetch(`http://localhost:${port}/docs`);
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/(html|markdown)/i);
    assert.match(res.headers.get('link') || '', /api-catalog/);
    assert.match(body, /BuyWhere MCP Integration/);
  });
});
