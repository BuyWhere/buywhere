// v2 wire contract guard (BUY-72537, mirror of api v2 contract).
//
// Atlas gate requires mcp.buywhere.ai/mcp to expose the same 13-tool manifest
// as api.buywhere.ai/mcp with deliver_to REQUIRED on all 5 v2 names. This
// test fails if the mcp-railway route silently regresses the v2 surface.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mcpPath = path.join(__dirname, '..', 'src', 'routes', 'mcp.ts');
const src = readFileSync(mcpPath, 'utf-8');

const V2_NAMES = [
  'search_products_v2',
  'find_best_price_v2',
  'get_deals_v2',
  'compare_products_v2',
  'get_product_v2',
];

test('mcp-railway declares all 5 v2 tools in V2_TOOLS', () => {
  for (const name of V2_NAMES) {
    assert.match(
      src,
      new RegExp(`name:\\s*'${name}'`),
      `missing ${name} in V2_TOOLS`,
    );
  }
});

test('each v2 description starts with REQUIRED deliver_to', () => {
  for (const name of V2_NAMES) {
    const re = new RegExp(`name:\\s*'${name}',\\s*\\n\\s*description:\\s*'REQUIRED deliver_to`);
    assert.match(src, re, `${name} description must start with 'REQUIRED deliver_to'`);
  }
});

test('each v2 tool requires deliver_to in inputSchema.required', () => {
  for (const name of V2_NAMES) {
    // crude but sufficient: ensure the literal `'deliver_to'` appears in a `required:` array
    // before the next tool entry after this v2 name.
    const idx = src.indexOf(`name: '${name}'`);
    assert.ok(idx >= 0, `${name} not found`);
    const slice = src.slice(idx, idx + 4000);
    assert.match(
      slice,
      /required:\s*\[[^\]]*'deliver_to'[^\]]*\]/,
      `${name} must list 'deliver_to' in inputSchema.required`,
    );
  }
});

test('TOOLS_ALL combined surface contains v1 + v2 names', () => {
  assert.match(
    src,
    /const\s+TOOLS_ALL\s*=\s*\[\.\.\.TOOLS,\s*\.\.\.V2_TOOLS\]/,
    'TOOLS_ALL must spread TOOLS + V2_TOOLS',
  );
});

test('dispatchTool handles all 5 v2 names', () => {
  for (const name of V2_NAMES) {
    const re = new RegExp(`case\\s+'${name}':`);
    assert.match(src, re, `dispatchTool missing case for ${name}`);
  }
});

test('requireDeliverTo helper rejects missing deliver_to with -32602', () => {
  assert.match(src, /-32602/, 'must return JSON-RPC -32602 INVALID_ARGUMENT');
  assert.match(src, /requires deliver_to/, 'error message must mention deliver_to');
});

test('find_best_price_v2 attaches shopping_job_id', () => {
  assert.match(src, /shopping_job_id/);
  assert.match(src, /attachShoppingJobId/);
});

test('get_product_v2 and compare_products_v2 attach outbound_url', () => {
  assert.match(src, /attachOutboundUrls/);
  assert.match(src, /buildClickUrl/);
});

test('tools/list and GET /mcp info endpoint use TOOLS_ALL', () => {
  // Both the GET info endpoint and POST tools/list must point at TOOLS_ALL
  // (not TOOLS), so v2 tools are visible to directory scanners.
  assert.match(src, /tools:\s*TOOLS_ALL\.map/);
  assert.match(src, /tools:\s*TOOLS_ALL\s*\}/);
});
