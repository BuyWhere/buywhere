#!/usr/bin/env node
/**
 * MCP production regression guard.
 *
 * Runs a minimal SSE-based MCP smoke test against the production endpoint
 * (default https://mcp.buywhere.ai) using a BUYWHERE_MCP_API_KEY.
 *
 * Validates:
 * - tools/list returns expected tools
 * - get_deals returns non-empty results for a known region
 * - healthz is 200
 *
 * Exits 0 on success, 1 on failure. Designed to run after a Railway deploy.
 */
import { parse as parseUrl } from 'url';
import https from 'https';
import http from 'http';

const MCP_ENDPOINT = process.env.MCP_ENDPOINT || 'https://mcp.buywhere.ai';
const MCP_API_KEY = process.env.BUYWHERE_MCP_API_KEY;

if (!MCP_API_KEY) {
  console.error('BUYWHERE_MCP_API_KEY is required');
  process.exit(1);
}

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = parseUrl(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({ ...parsed, ...opts }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function ssePost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = parseUrl(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const req = mod.request({
      ...parsed,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${MCP_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error('SSE request timed out'));
      }, 15000);
      res.on('data', (chunk) => {
        chunks.push(chunk);
        const text = chunks.join('');
        if (text.includes('"result"') || text.includes('"error"')) {
          clearTimeout(timer);
          req.destroy();
          resolve({ status: res.statusCode, body: text });
        }
      });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode, body: chunks.join('') });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function parseSseJson(text) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) {
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        return JSON.parse(payload);
      } catch (e) {
        // ignore non-json lines
      }
    }
  }
  return null;
}

async function main() {
  let failed = false;

  // Health check
  const health = await request(`${MCP_ENDPOINT}/healthz`);
  console.log(`healthz status=${health.status}`);
  if (health.status !== 200) {
    console.error('Health check failed');
    failed = true;
  }

  // tools/list via SSE
  try {
    const listRes = await ssePost(`${MCP_ENDPOINT}/sse`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    const listMsg = parseSseJson(listRes.body);
    if (!listMsg || listMsg.error) {
      console.error('tools/list failed:', listMsg?.error);
      failed = true;
    } else {
      const toolNames = (listMsg.result?.tools || []).map(t => t.name);
      console.log(`tools/list ok: ${toolNames.length} tools`);
      for (const name of ['get_deals', 'get_categories']) {
        if (!toolNames.includes(name)) {
          console.error(`Missing expected tool: ${name}`);
          failed = true;
        }
      }
    }
  } catch (err) {
    console.error('tools/list error:', err.message);
    failed = true;
  }

  // get_deals smoke test via SSE
  try {
    const dealsRes = await ssePost(`${MCP_ENDPOINT}/sse`, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'get_deals',
        arguments: { query: 'laptop', region: 'sg', limit: 5 },
      },
    });
    const dealsMsg = parseSseJson(dealsRes.body);
    if (!dealsMsg || dealsMsg.error) {
      console.error('get_deals failed:', dealsMsg?.error);
      failed = true;
    } else {
      const text = dealsMsg.result?.content?.[0]?.text || '{}';
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = {}; }
      const total = parsed?.meta?.total ?? parsed?.total;
      const products = parsed?.data || [];
      console.log(`get_deals ok: total=${total}, products=${products.length}`);
      if (products.length === 0) {
        console.error('get_deals returned zero products');
        failed = true;
      }
    }
  } catch (err) {
    console.error('get_deals error:', err.message);
    failed = true;
  }

  if (failed) {
    console.error('Regression guard FAILED');
    process.exit(1);
  }
  console.log('Regression guard PASSED');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
