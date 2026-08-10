// BUY-68192: regression test for direct tool-name JSON-RPC method dispatch.
//
// The authenticated MCP route used to reject calls like
// {"jsonrpc":"2.0","method":"list_categories","params":{}}
// with -32601 because only "tools/call" was handled. This test verifies the
// route source preserves the backward-compatibility branch.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const srcPath = require.resolve('../src/routes/mcp.ts');
const source = readFileSync(srcPath, 'utf8');

describe('MCP direct tool-name dispatch (BUY-68192)', () => {
  it('routes known tool names from the default switch branch', () => {
    const hasDefaultBranch = /default\s*:\s*\{[\s\S]*?const knownTool = TOOLS\.find\(\(t\) => t\.name === method\);[\s\S]*?await dispatchTool\(method, args\);/m.test(source);
    assert.ok(hasDefaultBranch, 'mcp.ts default branch should dispatch known tool names');
  });

  it('still handles canonical tools/call envelope', () => {
    const hasToolsCall = /case ['"]tools\/call['"]/.test(source);
    assert.ok(hasToolsCall, 'mcp.ts should keep the tools/call case');
  });
});
