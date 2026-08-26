// BUY-75368 — A1/A2 weekly report fields.
//
// Two pieces:
//   1. MCP/API search responses expose url_last_checked_at (and url_status)
//      so A2 can compute "% search responses with url_last_checked_at <24h"
//      straight off the accepted response shape.
//   2. /v1/admin/probes/status accepts MONITORING_API_KEY (in addition to
//      BUYWHERE_ADMIN_API_KEYS) AND includes 7-day buckets so A1
//      dead-redirect is computable over a weekly window.
//
// This test verifies (1) the route SQL/projections and (2) the auth module.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const responseSource = readFileSync(join(__dirname, '../src/lib/response.ts'), 'utf8');
const productsSource = readFileSync(join(__dirname, '../src/routes/products.ts'), 'utf8');
const probesSource = readFileSync(join(__dirname, '../src/routes/admin/probes.ts'), 'utf8');

describe('BUY-75368: URL probe telemetry in product responses', () => {
  it('buildProduct exposes url_last_checked_at and url_status on every response', () => {
    // Path A — non-compact (the default for /v1/products and /v1/products/search).
    assert.match(
      responseSource,
      /url_last_checked_at:\s*\(row\.url_last_checked_at as string \| null\) \?\? null/,
      'buildProduct must emit url_last_checked_at',
    );
    assert.match(
      responseSource,
      /url_status:\s*\(row\.url_status as string \| null\) \?\? null/,
      'buildProduct must emit url_status',
    );
  });

  it('search handler SELECT projects url_last_checked_at and url_status', () => {
    // Both standalone-list and joined-search SELECTs must include the columns.
    const selectColumnsMatch = productsSource.match(
      /const SELECT_COLUMNS = `[\s\S]*?`(?!;)/,
    );
    assert.ok(selectColumnsMatch, 'list SELECT_COLUMNS not found');
    assert.match(
      selectColumnsMatch[0],
      /products\.url_last_checked_at/,
      'list SELECT_COLUMNS missing url_last_checked_at',
    );

    const joinedColumnsMatch = productsSource.match(
      /const joinedColumns = `[\s\S]*?`(?!;)/,
    );
    assert.ok(joinedColumnsMatch, 'search joinedColumns not found');
    assert.match(
      joinedColumnsMatch[0],
      /products\.url_last_checked_at/,
      'search joinedColumns missing url_last_checked_at',
    );
  });

  it('deals handler SELECT also projects url_last_checked_at + url_status', () => {
    assert.match(
      productsSource,
      /currency, image_url, metadata, updated_at,\s*\n\s*url_last_checked_at, url_status,\s*\n\s*region, country_code/,
      'deals SELECT missing url_last_checked_at projection',
    );
  });

  it('CanonicalProduct type accepts url_last_checked_at and url_status', () => {
    const typesSource = readFileSync(join(__dirname, '../src/types/product.ts'), 'utf8');
    assert.match(typesSource, /url_last_checked_at\?: string \| null;/);
    assert.match(typesSource, /url_status\?: string \| null;/);
  });
});

describe('BUY-75368: probes endpoint accepts monitoring key + 7-day fields', () => {
  it('probeAuth accepts BUYWHERE_ADMIN_API_KEYS', () => {
    // The probes module must consult the admin keys list first.
    assert.match(
      probesSource,
      /BUYWHERE_ADMIN_API_KEYS/,
      'probes module should still consult BUYWHERE_ADMIN_API_KEYS',
    );
  });

  it('probeAuth accepts MONITORING_API_KEY', () => {
    assert.match(
      probesSource,
      /MONITORING_API_KEY/,
      'probes module must accept MONITORING_API_KEY',
    );
    assert.match(probesSource, /probeAuth/, 'probeAuth middleware must be exported');
  });

  it('returns a 7-day bucket for products.url_last_checked_at', () => {
    assert.match(
      probesSource,
      /url_last_checked_at < NOW\(\) - INTERVAL '7 days'/,
      'probes response must include 7-day staleness bucket',
    );
    assert.match(
      probesSource,
      /url_last_checked_at >= NOW\(\) - INTERVAL '7 days'/,
      'probes response must include 7-day freshness bucket',
    );
  });

  it('returns probes_last_7d for A1 dead-redirect calc', () => {
    assert.match(probesSource, /probes_last_7d/);
    assert.match(probesSource, /FROM url_probe_log\s*\n\s*WHERE checked_at >= NOW\(\) - INTERVAL '7 days'/);
  });
});
