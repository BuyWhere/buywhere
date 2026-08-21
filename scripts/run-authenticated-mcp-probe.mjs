#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_URL = process.env.BUYWHERE_MCP_BASE_URL
  || process.env.MCP_BASE_URL
  || 'https://api.buywhere.ai/mcp';

const API_KEY = process.env.BUYWHERE_MCP_API_KEY
  || process.env.MCP_TESTING_API_KEY
  || process.env.BUYWHERE_API_KEY
  || '';

const outputArg = process.argv[2];
const OUTPUT_PATH = outputArg
  || process.env.MCP_PROBE_OUTPUT_PATH
  || path.resolve(process.cwd(), 'data/mcp-authenticated-probe/latest.json');

function nowIso() {
  return new Date().toISOString();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function fail(message, context = {}) {
  const error = new Error(message);
  error.context = context;
  throw error;
}

async function readDescriptor(baseUrl) {
  const startedAt = Date.now();
  const response = await fetch(baseUrl, {
    headers: { Accept: 'application/json' },
  });
  const latencyMs = Date.now() - startedAt;
  const body = await response.json().catch(() => null);

  if (response.status !== 200) {
    fail('Descriptor request failed', { status: response.status, body });
  }

  if (!body || body.protocol !== 'mcp' || !ensureArray(body.methods).includes('tools/call')) {
    fail('Descriptor schema invalid', { body });
  }

  return {
    name: 'descriptor',
    ok: true,
    httpStatus: response.status,
    latencyMs,
    checks: ['protocol=mcp', 'tools/call advertised'],
  };
}

async function rpc(baseUrl, method, params, { auth = false, id = method } = {}) {
  const startedAt = Date.now();
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    headers.Authorization = `Bearer ${API_KEY}`;
  }

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const latencyMs = Date.now() - startedAt;
  const body = await response.json().catch(() => null);

  if (response.status !== 200) {
    fail(`RPC ${method} failed`, { status: response.status, body });
  }
  if (!body || body.jsonrpc !== '2.0' || body.id !== id) {
    fail(`RPC ${method} returned invalid JSON-RPC envelope`, { body });
  }
  if (body.error) {
    fail(`RPC ${method} returned JSON-RPC error`, { body });
  }

  return { latencyMs, body };
}

function parseToolResult(methodName, body) {
  const content = body?.result?.content;
  const text = ensureArray(content)[0]?.text;
  if (typeof text !== 'string') {
    fail(`Tool ${methodName} missing text content`, { body });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`Tool ${methodName} returned non-JSON content`, { text, error: String(error) });
  }

  return parsed;
}

async function run() {
  if (!API_KEY) {
    fail('Missing API key. Set BUYWHERE_MCP_API_KEY, MCP_TESTING_API_KEY, or BUYWHERE_API_KEY.');
  }

  const baseUrl = DEFAULT_BASE_URL;
  const startedAt = nowIso();
  const probes = [];

  probes.push(await readDescriptor(baseUrl));

  {
    const { latencyMs, body } = await rpc(baseUrl, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'cart-authenticated-probe', version: '1.0.0' },
    });

    if (body?.result?.protocolVersion !== '2024-11-05') {
      fail('Initialize returned unexpected protocol version', { body });
    }

    probes.push({
      name: 'initialize',
      ok: true,
      latencyMs,
      checks: ['protocolVersion=2024-11-05'],
    });
  }

  {
    const { latencyMs, body } = await rpc(baseUrl, 'tools/list');
    const tools = ensureArray(body?.result?.tools).map((tool) => tool?.name).filter(Boolean);
    const expectedTools = [
      'search_products',
      'get_product',
      'compare_products',
      'get_deals',
      'list_categories',
      'find_best_price',
    ];

    for (const toolName of expectedTools) {
      if (!tools.includes(toolName)) {
        fail('tools/list missing expected tool', { toolName, tools });
      }
    }

    probes.push({
      name: 'tools/list',
      ok: true,
      latencyMs,
      checks: [`toolCount=${tools.length}`],
    });
  }

  let firstProductId = null;

  {
    const { latencyMs, body } = await rpc(baseUrl, 'tools/call', {
      name: 'search_products',
      arguments: { q: 'laptop', country_code: 'SG', limit: 3, compact: true },
    }, { auth: true, id: 'search_products' });

    const parsed = parseToolResult('search_products', body);
    const results = ensureArray(parsed.results);
    if (!results.length) {
      fail('search_products returned no results', { parsed });
    }

    firstProductId = results[0]?.id || results[0]?.canonical_id || null;
    if (!firstProductId) {
      fail('search_products missing product identifier', { firstResult: results[0] });
    }

    probes.push({
      name: 'tools/call search_products',
      ok: true,
      latencyMs,
      reportedResponseTimeMs: parsed.response_time_ms,
      resultCount: results.length,
      checks: ['authenticated call', 'results[]', 'product id present'],
    });
  }

  {
    const { latencyMs, body } = await rpc(baseUrl, 'tools/call', {
      name: 'get_product',
      arguments: { id: firstProductId },
    }, { auth: true, id: 'get_product' });

    const parsed = parseToolResult('get_product', body);
    const results = ensureArray(parsed.results);
    if (!results.length) {
      fail('get_product returned no results', { parsed, firstProductId });
    }

    probes.push({
      name: 'tools/call get_product',
      ok: true,
      latencyMs,
      reportedResponseTimeMs: parsed.response_time_ms,
      checks: ['authenticated call', 'single product payload'],
    });
  }

  {
    const { latencyMs, body } = await rpc(baseUrl, 'tools/call', {
      name: 'list_categories',
      arguments: {},
    }, { auth: true, id: 'list_categories' });

    const parsed = parseToolResult('list_categories', body);
    if (!ensureArray(parsed.results).length) {
      fail('list_categories returned no categories', { parsed });
    }

    probes.push({
      name: 'tools/call list_categories',
      ok: true,
      latencyMs,
      checks: ['authenticated call', 'categories returned'],
    });
  }

  {
    const { latencyMs, body } = await rpc(baseUrl, 'tools/call', {
      name: 'find_best_price',
      arguments: { product_name: 'iphone 15', country_code: 'SG' },
    }, { auth: true, id: 'find_best_price' });

    const parsed = parseToolResult('find_best_price', body);
    const results = ensureArray(parsed.results);
    if (!results.length) {
      fail('find_best_price returned no results', { parsed });
    }

    probes.push({
      name: 'tools/call find_best_price',
      ok: true,
      latencyMs,
      checks: ['authenticated call', 'best price result present'],
    });
  }

  const latencies = probes.map((probe) => probe.latencyMs).filter((value) => typeof value === 'number');
  const avgLatencyMs = latencies.length
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : null;
  const maxLatencyMs = latencies.length ? Math.max(...latencies) : null;

  const summary = {
    probe: 'buywhere-authenticated-mcp',
    startedAt,
    completedAt: nowIso(),
    baseUrl,
    status: 'passed',
    schemaValid: true,
    errorRate: 0,
    avgLatencyMs,
    maxLatencyMs,
    probeCount: probes.length,
    probes,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(summary, null, 2));

  console.log(JSON.stringify(summary, null, 2));
}

run().catch(async (error) => {
  const failure = {
    probe: 'buywhere-authenticated-mcp',
    startedAt: nowIso(),
    completedAt: nowIso(),
    baseUrl: DEFAULT_BASE_URL,
    status: 'failed',
    schemaValid: false,
    errorRate: 1,
    error: error.message,
    context: error.context || null,
  };

  try {
    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(failure, null, 2));
  } catch {
    // Best effort only.
  }

  console.error(JSON.stringify(failure, null, 2));
  process.exit(1);
});
