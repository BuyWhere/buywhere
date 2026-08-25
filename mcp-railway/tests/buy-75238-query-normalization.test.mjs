// BUY-75238: Regression test for query → q normalization and deliver_to
// validation in the JSON-RPC handlers.
//
// Symptom: callers using `arguments.query=...` reached handleSearchProducts
// with an empty `q`, the FTS WHERE became a no-op, and a cached canned stub
// (3 deterministic IDs, total=364777600, rt=2ms) was served for ANY query
// string and ANY market — including unsupported `deliver_to` values like
// GB/FR/JP/DE.
//
// This test verifies the route source has the normalization + validation
// wired into both the canonical tools/call envelope and the bare-method
// (BUY-68192 / BUY-72102) fallback.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const srcPath = require.resolve('../src/routes/mcp.ts');
const source = readFileSync(srcPath, 'utf8');

describe('BUY-75238 query→q normalization + deliver_to validation', () => {
  it('defines normalizeToolArgs helper that maps query → q for search_products', () => {
    // Helper must exist and handle both v1 and v2.
    const hasHelper = /function normalizeToolArgs\(/.test(source);
    assert.ok(hasHelper, 'mcp.ts should define normalizeToolArgs');

    const handlesV1 = /normalizeToolArgs[\s\S]{0,500}'search_products' \|\| toolName === 'search_products_v2'/.test(source);
    assert.ok(handlesV1, 'normalizeToolArgs must cover both search_products and search_products_v2');

    const mapsQueryToQ = /toolArgs\.query\s*!=\s*null\s*&&\s*toolArgs\.q\s*==\s*null[\s\S]{0,80}toolArgs\.q\s*=\s*toolArgs\.query/.test(source);
    assert.ok(mapsQueryToQ, 'normalizeToolArgs must copy toolArgs.query → toolArgs.q when q is absent');
  });

  it('rejects unsupported deliver_to markets with -32602', () => {
    const hasValidation = /SUPPORTED_DELIVER_TO\.has\(country\)/.test(source);
    assert.ok(hasValidation, 'mcp.ts must validate deliver_to against SUPPORTED_DELIVER_TO');

    const hasErr = /Unsupported market for deliver_to/.test(source);
    assert.ok(hasErr, 'mcp.ts must surface a clear "Unsupported market" error message');

    // The error must be returned as a JSON-RPC -32602 from the route handler,
    // not just the helper — both the tools/call branch and the bare-method
    // branch must call normalizeToolArgs + return jsonrpcErr(-32602).
    const toolsCallBranch = /case ['"]tools\/call['"][\s\S]{0,2000}normalizeToolArgs\(toolName, toolArgs\)[\s\S]{0,500}jsonrpcErr\([^,]+,\s*-32602/.test(source);
    assert.ok(toolsCallBranch, 'tools/call branch must call normalizeToolArgs and return -32602 on validation failure');

    const bareBranch = /default\s*:\s*\{[\s\S]{0,2000}normalizeToolArgs\(method, directArgs\)[\s\S]{0,500}jsonrpcErr\([^,]+,\s*-32602/.test(source);
    assert.ok(bareBranch, 'bare-method default branch must call normalizeToolArgs and return -32602 on validation failure');
  });

  it('lists supported buyer markets including SEA + US', () => {
    const hasSG = /'SG'/.test(source);
    const hasUS = /'US'/.test(source);
    const hasMY = /'MY'/.test(source);
    const hasTH = /'TH'/.test(source);
    assert.ok(hasSG && hasUS && hasMY && hasTH, 'SUPPORTED_DELIVER_TO must include SG, US, MY, TH');
  });
});