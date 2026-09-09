// v2-request-log guard (BUY-72556).
//
// Atlas's daily v2-adoption aggregator (BUY-72550) reads
// monitoring.mcp_v2_request_log to compute deliver_to pass rates. Without the
// per-call writer wired into the JSON-RPC tools/call handler, the population
// is empty and the 7-day acceptance gate cannot be evaluated.
//
// This test fails the build if the writer is removed or weakened. DO NOT
// delete it to make a branch pass — restore the writer instead.
//
// The matching mcp-railway copy is checked at the same time: both surfaces
// (api.buywhere.ai/mcp and mcp.buywhere.ai/mcp) emit the per-call log.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const apiMcp = readFileSync(join(here, '..', 'src', 'routes', 'mcp.ts'), 'utf8');
const apiWriterPath = join(here, '..', 'src', 'monitoring', 'v2RequestLog.ts');
const apiWriter = existsSync(apiWriterPath)
  ? readFileSync(apiWriterPath, 'utf8')
  : null;
const mcpRailwayMcpPath = join(here, '..', '..', 'mcp-railway', 'src', 'routes', 'mcp.ts');
const mcpRailwayWriterPath = join(here, '..', '..', 'mcp-railway', 'src', 'monitoring', 'v2RequestLog.ts');
const mcpRailwayMcp = existsSync(mcpRailwayMcpPath)
  ? readFileSync(mcpRailwayMcpPath, 'utf8')
  : null;
const mcpRailwayWriter = existsSync(mcpRailwayWriterPath)
  ? readFileSync(mcpRailwayWriterPath, 'utf8')
  : null;

test('v2RequestLog writer module exists in api/src/monitoring', () => {
  assert.ok(apiWriter, 'api/src/monitoring/v2RequestLog.ts must exist');
});

test('v2RequestLog writer module exists in mcp-railway/src/monitoring', () => {
  assert.ok(mcpRailwayWriter, 'mcp-railway/src/monitoring/v2RequestLog.ts must exist');
});

test('api mcp.ts imports the writer', () => {
  assert.match(
    apiMcp,
    /import\s*\{[^}]*recordV2Request[^}]*\}\s*from\s*['"][^'"]*monitoring\/v2RequestLog['"]/,
    'api/src/routes/mcp.ts must import recordV2Request from monitoring/v2RequestLog',
  );
});

test('mcp-railway mcp.ts imports the writer', () => {
  assert.ok(mcpRailwayMcp, 'mcp-railway/src/routes/mcp.ts must exist');
  assert.match(
    mcpRailwayMcp,
    /import\s*\{[^}]*recordV2Request[^}]*\}\s*from\s*['"][^'"]*monitoring\/v2RequestLog['"]/,
    'mcp-railway/src/routes/mcp.ts must import recordV2Request from monitoring/v2RequestLog',
  );
});

test('api mcp.ts instruments gate_rejected v2 calls', () => {
  // The gate-rejected branch MUST call recordV2Request BEFORE returning the
  // -32602 envelope so the row is captured.
  // Find the v2 gate block and assert recordV2Request appears inside it.
  const idx = apiMcp.indexOf("endsWith('_v2')");
  assert.ok(idx > 0, 'api mcp.ts must have the v2 gate (endsWith(_v2))');
  const block = apiMcp.slice(idx, idx + 4000);
  assert.match(block, /recordV2Request\([^)]*gatePassed:\s*false[^)]*outcome:\s*['"]gate_rejected['"]/, 'gate_rejected path must call recordV2Request with gatePassed:false and outcome:gate_rejected');
});

test('api mcp.ts instruments successful v2 calls', () => {
  // After dispatchTool succeeds AND toolName ends with _v2, the writer must
  // record the success row.
  assert.match(apiMcp, /recordV2Request\([^)]*gatePassed:\s*true[^)]*outcome:\s*['"]success['"]/, 'success path must call recordV2Request with gatePassed:true and outcome:success');
});

test('v2RequestLog inserts into monitoring.mcp_v2_request_log', () => {
  assert.match(apiWriter, /INSERT INTO monitoring\.mcp_v2_request_log/, 'writer must INSERT into monitoring.mcp_v2_request_log');
  assert.match(apiWriter, /\[usage_metering\] drop:/, 'writer must log [usage_metering] drop: on failure');
  assert.match(apiWriter, /5[_\s]?000|FLUSH_INTERVAL_MS\s*=\s*5_?000/, 'writer must flush on a 5-second cadence');
});

test('mcp-railway mirrors the gate instrumentation', () => {
  assert.match(
    mcpRailwayMcp,
    /recordV2Request\([^)]*gatePassed:\s*false[^)]*outcome:\s*['"]gate_rejected['"]/,
    'mcp-railway mcp.ts must record gate_rejected v2 calls',
  );
  assert.match(
    mcpRailwayMcp,
    /recordV2Request\([^)]*gatePassed:\s*true[^)]*outcome:\s*['"]success['"]/,
    'mcp-railway mcp.ts must record successful v2 calls',
  );
});

test('v2 gate does NOT log v1 calls (only _v2 suffix)', () => {
  // The discriminator MUST be `endsWith('_v2')` (or `=== '_v2'`), NOT a blanket
  // log on every tools/call. v1 tools are out of scope per the issue.
  const apiGate = apiMcp.match(/endsWith\('_v2'\)/);
  assert.ok(apiGate, 'v2 discriminator must use endsWith(_v2)');
  // Confirm the writer is only invoked inside the `if (toolName.endsWith('_v2'))`
  // branch, not unconditionally.
  const writerCalls = (apiMcp.match(/recordV2Request\(/g) || []).length;
  assert.ok(writerCalls >= 3, `expected at least 3 recordV2Request call sites (gate_rejected, success, rpc_error), got ${writerCalls}`);
});
