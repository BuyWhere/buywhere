// P2.7 / BUY-71817 — v2 tool surface guard.
//
// The v2 surface MUST make `deliver_to` REQUIRED on search_products, get_deals
// and find_best_price. Calls with api_version=v2 and missing deliver_to must
// return a JSON-RPC -32602 error (mapped to INVALID_ARGUMENT / HTTP 400 in the
// existing envelope envelope). The v1 surface must remain unchanged (no
// regression in v1 callers — deliver_to stays optional, existing -32602 errors
// still surface).
//
// These tests fail the build if (a) the v2 gate disappears, (b) the constants
// drift, or (c) v1 callers get blocked. DO NOT delete or weaken to make a branch
// pass — restore the v2 contract instead.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes', 'mcp.ts'),
  'utf8'
);

const V2_TOOLS = ['search_products', 'get_deals', 'find_best_price'];

function blockForTool(name) {
  const idx = src.indexOf(`name: '${name}'`);
  assert.ok(idx >= 0, `${name} tool not found in mcp.ts`);
  const nextTool = src.indexOf("name: '", idx + 10);
  const end = nextTool > 0 ? nextTool : idx + 6000;
  return src.slice(idx, end);
}

test('v2 tools expose api_version param with v1/v2 enum', () => {
  for (const tool of V2_TOOLS) {
    const block = blockForTool(tool);
    assert.match(
      block,
      /api_version:\s*\{\s*type:\s*'string',\s*enum:\s*\[\s*'v1'\s*,\s*'v2'\s*\]/,
      `${tool} must declare api_version enum [v1, v2]`
    );
  }
});

test('v2 tools expose deliver_to param documented as REQUIRED on v2', () => {
  for (const tool of V2_TOOLS) {
    const block = blockForTool(tool);
    assert.match(
      block,
      /deliver_to:\s*\{\s*type:\s*'string'/,
      `${tool} must declare deliver_to parameter`
    );
    assert.match(
      block,
      /REQUIRED on api_version=v2/,
      `${tool} description must mark deliver_to as REQUIRED on api_version=v2`
    );
  }
});

test('v2 gate sits in dispatchTool and rejects missing deliver_to', () => {
  // The gate is the central block: V2_DELIVER_TO_TOOLS check + api_version === 'v2'
  // + throw -32602 with INVALID_ARGUMENT prefix.
  assert.match(
    src,
    /V2_DELIVER_TO_TOOLS\.has\(name\)\s*&&\s*args\.api_version\s*===\s*'v2'/,
    'v2 gate must be present in dispatchTool'
  );
  assert.match(
    src,
    /INVALID_ARGUMENT: deliver_to is REQUIRED on api_version=v2/,
    'v2 gate must throw INVALID_ARGUMENT error message'
  );
  assert.match(
    src,
    /code:\s*-32602/,
    'v2 gate must throw a JSON-RPC -32602 error'
  );
});

test('v2 gate normalizes deliver_to to uppercase', () => {
  // The dispatcher should normalize so handlers don't see a mix of sg/SG.
  const gateIdx = src.indexOf('V2_DELIVER_TO_TOOLS.has(name)');
  assert.ok(gateIdx >= 0, 'v2 gate not found');
  const gateBlock = src.slice(gateIdx, gateIdx + 1200);
  assert.match(
    gateBlock,
    /args\.deliver_to\s*=\s*\w+\.toUpperCase\(\)/,
    'v2 gate must normalize deliver_to to uppercase'
  );
});

test('v1 surface unchanged: search_products does not require deliver_to', () => {
  // The JSON schema `required` array must NOT contain deliver_to on v1.
  // (Manifest is uniform; v2 is enforced at runtime — v1 callers keep
  // deliver_to optional.)
  const block = blockForTool('search_products');
  // The required array in v1 is empty (only product_name etc. are required
  // for tools that have it). We assert that deliver_to is NOT in any
  // `required: [...]` list for the v2 tools.
  const requiredMatches = [...block.matchAll(/required:\s*\[([^\]]*)\]/g)];
  for (const m of requiredMatches) {
    assert.ok(
      !/deliver_to/.test(m[1]),
      `deliver_to must NOT be in a 'required' array on v1 manifest (found: ${m[1].trim()})`
    );
  }
});

test('v2 gate applies to all three v2 tools (search_products, get_deals, find_best_price)', () => {
  for (const tool of V2_TOOLS) {
    // The gate is a single site using V2_DELIVER_TO_TOOLS. We verify the set
    // is built from the three tools by checking the literal string in the source.
    assert.ok(
      src.includes(`'${tool}'`),
      `${tool} must be referenced in v2 gate set (V2_DELIVER_TO_TOOLS)`
    );
  }
  // Verify the set literal contains exactly the three v2 tools.
  const setMatch = src.match(/V2_DELIVER_TO_TOOLS\s*=\s*new Set\(\[([^\]]+)\]\)/);
  assert.ok(setMatch, 'V2_DELIVER_TO_TOOLS set literal not found');
  const items = setMatch[1].split(',').map(s => s.trim().replace(/^'/, '').replace(/'$/, ''));
  for (const tool of V2_TOOLS) {
    assert.ok(items.includes(tool), `V2_DELIVER_TO_TOOLS missing ${tool}`);
  }
});

test('search_products handler now prefers deliver_to over country_code for the v2 parity gate', () => {
  // The v2 acceptance gate says: v2 with deliver_to=SG returns same shape as
  // v1 with deliver_to=SG. handleSearchProducts must therefore read deliver_to
  // ahead of country_code/country when resolving the country filter.
  const handleIdx = src.indexOf('async function handleSearchProducts');
  assert.ok(handleIdx >= 0, 'handleSearchProducts not found');
  const handleBlock = src.slice(handleIdx, src.indexOf('async function handleSearchProducts', handleIdx + 100));
  assert.match(
    handleBlock,
    /args\.deliver_to[^|]+\|\|\s*\(args\.country_code/,
    'handleSearchProducts must check deliver_to before country_code'
  );
});

test('regression guard: deliver_to signature is preserved on all three v2 tools', () => {
  // The legacy deliver-to-contract test already asserts that deliver_to appears
  // in the tool manifest. Re-assert here so the v2 rollup doesn't accidentally
  // delete the v1 surface or regress the soft contract.
  for (const tool of V2_TOOLS) {
    const block = blockForTool(tool);
    assert.match(
      block,
      /deliver_to:\s*\{\s*type:\s*'string'/,
      `${tool} must keep deliver_to as a string parameter (soft contract)`
    );
  }
});
