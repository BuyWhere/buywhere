// BUY-70000: Regression tests for JSON-RPC envelope schema (request_id, timestamp)
// and 57014 degraded fail-open behavior.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const srcPath = require.resolve('../src/routes/mcp.ts');
const source = readFileSync(srcPath, 'utf8');

describe('BUY-70000: JSON-RPC envelope schema', () => {
  it('jsonrpcOk includes request_id via jsonrpcRequestId and timestamp', () => {
    assert.ok(
      source.includes('function jsonrpcRequestId'),
      'jsonrpcRequestId helper must exist'
    );
    assert.ok(
      source.includes('jsonrpcRequestId(id)'),
      'jsonrpcOk must call jsonrpcRequestId(id) for UUID generation'
    );
    // The return line for jsonrpcOk must include both request_id and timestamp
    assert.ok(
      /function jsonrpcOk\([\s\S]*?timestamp: new Date\(\)\.toISOString\(\)[\s\S]*?return/.test(source) ||
      /return \{ jsonrpc: '2\.0', id, request_id: jsonrpcRequestId\(id\), timestamp:/.test(source),
      'jsonrpcOk must include timestamp in response'
    );
  });

  it('jsonrpcErr includes request_id via jsonrpcRequestId and timestamp', () => {
    // Find the jsonrpcErr function body and check for request_id + timestamp
    assert.ok(
      /function jsonrpcErr\([\s\S]*?request_id: jsonrpcRequestId\(id\)/.test(source),
      'jsonrpcErr must include UUID request_id'
    );
    assert.ok(
      /function jsonrpcErr\([\s\S]*?timestamp: new Date\(\)\.toISOString\(\)/.test(source),
      'jsonrpcErr must include timestamp'
    );
  });

  it('jsonrpcRequestId returns randomUUID (not passthrough id)', () => {
    assert.ok(
      source.includes('return randomUUID()'),
      'jsonrpcRequestId must return randomUUID()'
    );
    // Must NOT use the old passthrough pattern
    assert.ok(
      !source.includes("const requestId = typeof id === 'string' ? id : null;\n  return { jsonrpc: '2.0', id, request_id: requestId, result }"),
      'must not use old passthrough request_id pattern in jsonrpcOk'
    );
  });

  it('error responses include buildErrorEnvelope for standardized domain codes', () => {
    assert.ok(
      source.includes('errorData.envelope = buildErrorEnvelope'),
      'jsonrpcErr must attach buildErrorEnvelope to error.data.envelope'
    );
  });
});

describe('BUY-70000: search_products 57014 degraded fail-open', () => {
  it('catches 57014 (statement_timeout) and returns degraded response instead of -32603', () => {
    assert.ok(
      source.includes("57014") || source.includes("'57014'"),
      'must catch PostgreSQL error code 57014'
    );
    assert.ok(
      source.includes('degraded'),
      'must return degraded response on 57014'
    );
  });
});
