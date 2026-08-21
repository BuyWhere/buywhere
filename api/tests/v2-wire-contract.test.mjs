// v2 wire contract guard (BUY-72533, P2.7 v2 wire binding).
//
// Reed's P2.7 spec (BUY-72531) requires 5 v2 tools on the JSON-RPC /mcp surface
// with `deliver_to` REQUIRED in inputSchema. The Atlas acceptance gate fires
// green only when LIVE /tools/list shows the 5 v2 names, each marks deliver_to
// required, and a live call without deliver_to returns -32602.
//
// This test fails the build if any of those promises silently regress.
// Mirrors deliver-to-contract.test.mjs pattern.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes');
const MCP_PRIMARY = readFileSync(join(ROUTES_DIR, 'mcp.ts'), 'utf8');

const V2_TOOLS = [
  'search_products_v2',
  'find_best_price_v2',
  'get_deals_v2',
  'compare_products_v2',
  'get_product_v2',
];

function findToolBlock(src, name) {
  const idx = src.indexOf(`name: '${name}'`);
  if (idx < 0) return null;
  const nextTool = src.indexOf("name: '", idx + name.length + 10);
  const end = nextTool > 0 ? nextTool : idx + 4000;
  return src.slice(idx, end);
}

// Match descriptions whether they're single- or double-quoted (some v2 descriptions
// contain backticks for inline code references like `shopping_job_id`).
const DESCRIPTION_RE = /description:\s*(['"])(.+?)\1/;

test('primary MCP route declares all 5 v2 tools', () => {
  for (const tool of V2_TOOLS) {
    const block = findToolBlock(MCP_PRIMARY, tool);
    assert.ok(block, `${tool} must be declared in api/src/routes/mcp.ts`);
  }
});

test('each v2 tool description starts with REQUIRED deliver_to', () => {
  for (const tool of V2_TOOLS) {
    const block = findToolBlock(MCP_PRIMARY, tool);
    const m = block && block.match(DESCRIPTION_RE);
    assert.ok(m, `${tool} description not found`);
    assert.ok(
      m[2].startsWith('REQUIRED deliver_to'),
      `${tool} description must begin with literal "REQUIRED deliver_to" — got: ${m[2].slice(0, 60)}…`,
    );
  }
});

test('each v2 tool requires deliver_to in inputSchema.required', () => {
  for (const tool of V2_TOOLS) {
    const block = findToolBlock(MCP_PRIMARY, tool);
    const m = block && block.match(/required:\s*\[([^\]]+)\]/);
    assert.ok(m, `${tool} inputSchema.required array not found`);
    const required = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    assert.ok(
      required.includes('deliver_to'),
      `${tool} must include "deliver_to" in inputSchema.required — got: [${required.join(', ')}]`,
    );
  }
});

test('tools/list count: 8 v1 + 5 v2 = 13 entries', () => {
  // 8 v1 names appear once each, 5 v2 names appear once each.
  // Match any single-quoted tool name (digits allowed for _v2).
  const allTools = MCP_PRIMARY.match(/name: '[a-z0-9_]+'/g) || [];
  assert.strictEqual(allTools.length, 13, `expected 13 total tools (8 v1 + 5 v2), got ${allTools.length}: ${allTools.join(', ')}`);
  const v1Names = ['search_products', 'get_product', 'compare_products', 'get_deals', 'list_categories', 'find_best_price', 'find_similar', 'ingest_products'];
  const v2Names = V2_TOOLS;
  for (const name of v1Names) assert.ok(allTools.includes(`name: '${name}'`), `v1 tool ${name} missing`);
  for (const name of v2Names) assert.ok(allTools.includes(`name: '${name}'`), `v2 tool ${name} missing`);
});

test('dispatchTool handles all 5 v2 names', () => {
  for (const tool of V2_TOOLS) {
    assert.match(MCP_PRIMARY, new RegExp(`case '${tool}':`), `${tool} must be in dispatchTool switch`);
  }
});

test('deliver_to gate rejects v2 calls without deliver_to', () => {
  // The gate is a toolName.endsWith('_v2') check + a deliver_to presence check.
  assert.match(MCP_PRIMARY, /toolName\.endsWith\('_v2'\)/, 'gate must use toolName.endsWith(_v2)');
  assert.match(MCP_PRIMARY, /-32602/, 'gate must return -32602 INVALID_ARGUMENT');
  // Must be in the tools/call handler, before dispatchTool.
  const gateIdx = MCP_PRIMARY.search(/toolName\.endsWith\('_v2'\)/);
  const dispatchIdx = MCP_PRIMARY.indexOf('dispatchTool(toolName, toolArgs)');
  assert.ok(gateIdx > 0 && dispatchIdx > 0, 'gate and dispatch must both be present');
  assert.ok(gateIdx < dispatchIdx, 'deliver_to gate must run BEFORE dispatchTool');
});

// mcp-railway is a separate package; ship the same v2 surface there too.
const MCP_RAILWAY = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mcp-railway', 'src', 'routes', 'mcp.ts'),
  'utf8',
);

test('mcp-railway route declares all 5 v2 tools', () => {
  for (const tool of V2_TOOLS) {
    const block = findToolBlock(MCP_RAILWAY, tool);
    assert.ok(block, `${tool} must be declared in mcp-railway/src/routes/mcp.ts`);
  }
});

test('mcp-railway: each v2 description starts with REQUIRED deliver_to', () => {
  for (const tool of V2_TOOLS) {
    const block = findToolBlock(MCP_RAILWAY, tool);
    const m = block && block.match(DESCRIPTION_RE);
    assert.ok(m, `${tool} description not found in mcp-railway`);
    assert.ok(
      m[2].startsWith('REQUIRED deliver_to'),
      `mcp-railway ${tool} description must begin with "REQUIRED deliver_to"`,
    );
  }
});

test('mcp-railway: dispatchTool handles all 5 v2 names', () => {
  for (const tool of V2_TOOLS) {
    assert.match(MCP_RAILWAY, new RegExp(`case '${tool}':`), `mcp-railway ${tool} must be in dispatchTool switch`);
  }
});

test('mcp-railway: deliver_to gate rejects v2 calls without deliver_to', () => {
  assert.match(MCP_RAILWAY, /toolName\.endsWith\('_v2'\)/, 'mcp-railway gate must use toolName.endsWith(_v2)');
  assert.match(MCP_RAILWAY, /-32602/, 'mcp-railway gate must return -32602');
});
