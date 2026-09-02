// BUY-32028 + BUY-32228: regression guard for ts_rank ORDER BY placement.
//
// BUY-32028 removed ts_rank from the warmSearchCache CTE in api/src/routes/products.ts
// because on broad US queries (laptop+US = 70k+ matches) the CTE materialised all rows
// before LIMIT and stalled the cache warm-up, leaving the live endpoint cold.
//
// BUY-59923 bounded the live /v1/products/search CTE after measuring that sorting all
// FTS hits by ts_rank for high-cardinality SG brand terms (`iphone 16 pro`, `dyson
// airwrap`) still hit the 15s handler timeout. The live path now selects a small,
// partition-pruned recent_hits slice by indexed freshness first, then ranks only that bounded slice.
//
// Net rule:
//   - warmSearchCache CTE and any other search CTE that is NOT the live /v1/products/search
//     useFtsRanking branch must NOT use ts_rank in ORDER BY.
//   - live /v1/products/search useFtsRanking branch MUST rank a bounded recent_hits
//     slice and must NOT regress to either all-hit ts_rank sorting or the slow
//     `id DESC` + outer `products.updated_at DESC` pattern.
//
// Run in CI and as a pre-deploy gate.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const apiSrcRoot = path.resolve(__dirname, '..', 'src');
const productsTsPath = path.resolve(apiSrcRoot, 'routes', 'products.ts');
const mcpTsPath = path.resolve(apiSrcRoot, 'routes', 'mcp.ts');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function readProductsSource() {
  return fs.readFileSync(productsTsPath, 'utf8');
}

function extractUseFtsRankingBlock(src) {
  const start = src.indexOf('if (useFtsRanking)');
  assert.ok(start >= 0, 'Expected to find `if (useFtsRanking)` branch in products.ts');
  const end = src.indexOf('} else {', start);
  assert.ok(end > start, 'Expected `} else {` after `if (useFtsRanking)`');
  return src.slice(start, end);
}

describe('BUY-32028 + BUY-32228: ts_rank ORDER BY regression guard', () => {
  it('warmSearchCache CTE in products.ts must NOT use ts_rank in ORDER BY', () => {
    // Pull the warmSearchCache function source by string match.
    const src = readProductsSource();
    const fnStart = src.indexOf('function warmSearchCache');
    assert.ok(fnStart >= 0, 'Expected warmSearchCache function in products.ts');
    // The function body extends until the matching closing brace at column 0.
    const lines = src.slice(fnStart).split('\n');
    const offenders = [];
    lines.forEach((line, i) => {
      if (/\bts_rank\s*\(/.test(line) && /ORDER\s+BY/i.test(line)) {
        offenders.push(`warmSearchCache line ${i + 1}: ${line.trim()}`);
      }
    });
    assert.deepEqual(
      offenders,
      [],
      `ts_rank() found in warmSearchCache ORDER BY (re-introduces the BUY-32028 20s warm-up regression):\n  ${offenders.join('\n  ')}`
    );
  });

  it('other non-live search files must not contain ts_rank in any ORDER BY clause', () => {
    // Every .ts file under api/src EXCEPT the live /v1/products/search useFtsRanking branch
    // should be free of `ts_rank(...)` paired with `ORDER BY` on the same line.
    const offenders = [];
    for (const file of walk(apiSrcRoot)) {
      const rel = path.relative(apiSrcRoot, file);
      if (rel === path.join('routes', 'products.ts')) continue; // handled by warmSearchCache + live-block tests below
      if (rel === path.join('routes', 'mcp.ts')) continue; // BUY-74181: MCP hybrid ranks its bounded 200-candidate FTS slice.
      const source = fs.readFileSync(file, 'utf8');
      const lines = source.split('\n');
      lines.forEach((line, i) => {
        if (/\bts_rank\s*\(/.test(line) && /ORDER\s+BY/i.test(line)) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `ts_rank() found in ORDER BY clauses outside the live search handler (BUY-32028 regression):\n  ${offenders.join('\n  ')}`
    );
  });

  it('live /v1/products/search useFtsRanking branch projects ts_rank in the SELECT', () => {
    // BUY-32228: ts_rank must be in top_ids SELECT to avoid Merge Append on partitioned table.
    // BUY-77644: uses rh.search_vector from recent_hits CTE (not rhp.products.search_vector).
    const src = readProductsSource();
    const block = extractUseFtsRankingBlock(src);
    assert.ok(
      /ts_rank\(rh\.search_vector,/.test(block),
      'Expected top_ids to compute ts_rank(rh.search_vector, ...) — BUY-32228 avoids Merge Append on partitioned table'
    );
    assert.ok(
      /AS\s+rank/i.test(block),
      'Expected top_ids to alias ts_rank as \'rank\' for ORDER BY rank DESC'
    );
  });


  it('live useFtsRanking branch bounds FTS hits before ranking', () => {
    const src = readProductsSource();
    const block = extractUseFtsRankingBlock(src);
    const recentHits = block.match(/WITH\s+recent_hits\s+AS\s+(?:MATERIALIZED\s+)?\(([\s\S]*?)\),\s*top_ids\s+AS/i);
    assert.ok(recentHits, 'Expected a `WITH recent_hits AS [MATERIALIZED] (...)` CTE before top_ids');
    assert.ok(/LIMIT\s+\$?\{?CANDIDATE_CAP\}?/i.test(recentHits[1]), 'Expected recent_hits to cap candidates before ranking.');
    assert.ok(!/ORDER\s+BY\s+updated_at\s+DESC/i.test(recentHits[1]), 'Expected recent_hits to avoid sorting the full FTS match set before LIMIT.');
  });

  it('live useFtsRanking branch ranks only recent_hits by rank DESC', () => {
    const src = readProductsSource();
    const block = extractUseFtsRankingBlock(src);
    const cte = block.match(/top_ids\s+AS\s*\(([\s\S]*?)\)\s*SELECT/i);
    assert.ok(cte, 'Expected a `top_ids AS (...)` CTE in the useFtsRanking branch');
    assert.ok(/FROM\s+recent_hits/i.test(cte[1]), 'Expected top_ids to read from bounded recent_hits');
    assert.ok(
      /ORDER\s+BY\s+rank\s+DESC/i.test(cte[1]),
      'Expected top_ids to `ORDER BY rank DESC` after recent_hits bounded the candidate set.'
    );
  });

  it('live useFtsRanking branch orders the final SELECT by top_ids.rank DESC', () => {
    const src = readProductsSource();
    const block = extractUseFtsRankingBlock(src);
    assert.ok(
      /ORDER\s+BY\s+top_ids\.rank\s+DESC/i.test(block),
      'Expected the live outer SELECT to `ORDER BY top_ids.rank DESC` so relevance ranking '
        + 'survives the join. The previous `ORDER BY products.updated_at DESC` triggered '
        + 'a full partition Merge Append on the products table (BUY-32228).'
    );
  });

  it('live useFtsRanking branch does NOT regress to id DESC + outer products.updated_at DESC', () => {
    const src = readProductsSource();
    const block = extractUseFtsRankingBlock(src);
    const cte = block.match(/top_ids\s+AS\s*\(([\s\S]*?)\)\s*SELECT/i);
    assert.ok(cte, 'Expected a `top_ids AS (...)` CTE');
    const cteHasIdDesc = /ORDER\s+BY\s+id\s+DESC/i.test(cte[1]);
    const outerHasProductsUpdatedAt = /ORDER\s+BY\s+products\.updated_at\s+DESC/i.test(block);
    assert.ok(
      !(cteHasIdDesc && outerHasProductsUpdatedAt),
      'The slow path `id DESC in CTE + ORDER BY products.updated_at DESC in outer` was '
        + 'reintroduced. On the partitioned products table this forced a Merge Append over '
        + 'all 4.1M rows (BUY-32228). Restore ts_rank in the CTE.'
    );
  });

  it('8s statement_timeout guard from BUY-31228 is still in place (runtime safety net)', () => {
    const src = readProductsSource();
    assert.ok(
      /SET\s+LOCAL\s+statement_timeout/i.test(src),
      'Expected the 8s statement_timeout guard (BUY-31228) to still be applied — '
        + 'it is the runtime safety net for the live /search handler.'
    );
  });

  it('BUY-60052 tries bounded N-1 AND relaxations before broad OR fallback', () => {
    const src = readProductsSource();
    const fallbackStart = src.indexOf('zero-AND -> broad-OR fallback');
    const broadOrStart = src.indexOf('let r = await client.query(baseQuery, dataParams);', fallbackStart);
    assert.ok(fallbackStart >= 0, 'Expected BUY-60052 zero-AND fallback comment');
    assert.ok(broadOrStart > fallbackStart, 'Expected broad OR baseQuery fallback after BUY-60052 block');
    const fallbackBlock = src.slice(fallbackStart, broadOrStart);
    assert.ok(/ftsLexemes\.length\s*>=\s*3/.test(fallbackBlock), 'Expected N-1 fallback to be limited to 3+ token queries');
    assert.ok(/websearch_to_tsquery\('english',\s*\$\$\{relaxedParamIdx\}\)/.test(fallbackBlock), 'Expected relaxed passes to keep AND semantics');
    assert.ok(/return\s+relaxedRes/.test(fallbackBlock), 'Expected successful relaxed pass to return before broad OR fallback');
  });

  it('BUY-61117 keeps zero-AND SG broad queries bounded by FTS before sorting', () => {
    const src = readProductsSource();
    const fallbackStart = src.indexOf('BUY-60112: the remaining zero-AND SG path');
    const broadOrStart = src.indexOf('let r = await client.query(baseQuery, dataParams);', fallbackStart);
    assert.ok(fallbackStart >= 0, 'Expected BUY-60112 zero-AND SG fallback comment');
    assert.ok(broadOrStart > fallbackStart, 'Expected broad OR baseQuery fallback after BUY-60112 block');
    const boundedSliceStart = src.lastIndexOf('const runBoundedSgMatch', fallbackStart);
    const fallbackBlock = src.slice(boundedSliceStart, broadOrStart);
    assert.ok(/andRes\.rows\.length\s*===\s*0\s*&&\s*useSgFreshnessGuardrail/.test(fallbackBlock), 'Expected fallback to be limited to zero-AND SG relevance searches');
    assert.ok(/runBoundedSgMatch\(ftsOrMatch\)/.test(fallbackBlock), 'Expected fresh bounded FTS fallback before broad OR');
    assert.ok(/runBoundedSgMatch\(ftsOrMatch,\s*dataParams,\s*broadRecentSliceWhereClause\)/.test(fallbackBlock), 'Expected all-time bounded FTS retry before broad OR');
    assert.ok(/AND\s+\$\{matchExpr\}[\s\S]*LIMIT\s+\$\{CANDIDATE_CAP\}/.test(fallbackBlock), 'Expected FTS match inside the candidate CTE before its cap');
    assert.ok(/LIMIT\s+\$\{CANDIDATE_CAP\}/.test(fallbackBlock), 'Expected fallback to cap matched candidates before ranking');
    assert.ok(!/ORDER\s+BY\s+updated_at\s+DESC/.test(fallbackBlock), 'Expected bounded SG fallback to avoid sorting the full FTS match set before LIMIT');
    assert.ok(!/ORDER\s+BY\s+id\s+DESC/.test(fallbackBlock), 'Expected bounded SG fallback to avoid partition-wide id ordering');
    assert.ok(/WITH\s+recent_candidates\s+AS\s+MATERIALIZED\s+\(/.test(src), 'Expected matched candidates to be materialized before ranking');
  });

  it('BUY-61117 defaults keyword search to the RAM-fitting search_products tier', () => {
    const src = readProductsSource();
    assert.ok(
      /process\.env\.SEARCH_USE_TIER\s*!==\s*'0'/.test(src),
      'Expected SEARCH_USE_TIER to be an opt-out kill switch, not an opt-in gate'
    );
    assert.ok(
      /searchMode\s*===\s*'keyword'/.test(src),
      'Expected default tier cutover to be limited to keyword search so semantic/hybrid remain unchanged'
    );
    assert.ok(
      /FROM\s+(\$\{ftsTable\}|search_products)\s+sp/.test(src),
      'Expected default keyword path to use the RAM-fitting search_products tier'
    );
  });

  it('BUY-80220 boosts primary devices and demotes accessories above pure ts_rank', () => {
    const src = readProductsSource();
    assert.ok(
      /const primaryDeviceBoost = `/.test(src),
      'Expected primaryDeviceBoost multiplier for iPhone/iPad/AirPods/tablet/TV/audio searches'
    );
    assert.ok(
      /const deviceAccessoryPenalty = `/.test(src),
      'Expected deviceAccessoryPenalty multiplier to demote cases/mounts/glass/AppleCare'
    );
    assert.ok(
      /\$\{primaryDeviceBoost\.replace\(\/sp\\\.\/g, 'c\.'\)\}/.test(src),
      'Expected search_products FTS rank to apply primaryDeviceBoost inside the bounded top CTE'
    );
    assert.ok(
      /\$\{deviceAccessoryPenalty\.replace\(\/sp\\\.\/g, 'c\.'\)\}/.test(src),
      'Expected search_products FTS rank to apply deviceAccessoryPenalty inside the bounded top CTE'
    );
    assert.ok(
      /BUY-80220: boost primary devices and demote accessory SKUs above pure ts_rank\.[\s\S]*THEN 3\.0 ELSE 1\.0[\s\S]*THEN 0\.08 ELSE 1\.0/.test(src),
      'Expected archive products FTS path to boost devices and strongly demote accessories before ts_rank ordering'
    );
  });

  it('BUY-64151 releaseClientSafely discards transaction-poisoned clients (transactionStatus === 3)', () => {
    const src = fs.readFileSync(mcpTsPath, 'utf8');
    const match = src.match(/function\s+releaseClientSafely\s*\([\s\S]*?\n\}\n/);
    assert.ok(match, 'Expected releaseClientSafely() in api/src/routes/mcp.ts');
    const fn = match[0];
    assert.ok(
      /client\.transactionStatus\s*===\s*3/.test(fn),
      'Expected releaseClientSafely to check pg transactionStatus === 3, not client.state'
    );
    assert.ok(
      !/client\.state\s*===\s*['"]error['"]/.test(fn),
      'releaseClientSafely must not rely on client.state === "error"; that tracks socket state, not transaction state'
    );
    assert.ok(
      /client\.release\(true\)/.test(fn),
      'Expected releaseClientSafely to call client.release(true) for poisoned connections'
    );
  });

  it('BUY-76520 hybrid fts_cand CTE carries rank cols + qualifies via fts_cand (no bare products.* 42P01)', () => {
    // Regression: the hybrid FTS query selected only (id, search_vector) into
    // fts_cand, but the ts_rank(...) * multiplier still referenced products.* columns
    // still referenced products.source/price/category/metadata. fts_top's FROM is
    // fts_cand (not products), so Postgres raised 42P01 -> HTTP 500 on mode=hybrid.
    const src = readProductsSource();
    const idx = src.indexOf('searchMode === \'hybrid\'');
    assert.ok(idx >= 0, 'Expected the searchMode === \'hybrid\' branch in products.ts');
    const ftsBlock = src.slice(idx, idx + 900);
    // BUY-76520: fts_cand now projects only (id, search_vector) — ts_rank operates
    // directly on the search_vector column without a multiplier needing product columns.
    assert.ok(
      /SELECT\s+id, search_vector\s+FROM\s+products(?!\s*,)/.test(ftsBlock),
      'fts_cand must select id, search_vector FROM products (ts_rank uses search_vector column directly)'
    );
    // BUY-76520: fts_cand projects only (id, search_vector) — ts_rank computes directly.
    assert.ok(
      /ts_rank\(search_vector,/.test(ftsBlock),
      'hybrid fts_top must use ts_rank(search_vector, ...) from fts_cand'
    );
    assert.ok(
      !/ORDER BY \(ts_rank\(search_vector[^)]*\) \* [^)]*\bproducts\./.test(ftsBlock),
      'hybrid fts_top ORDER BY must not reference a bare products.* alias (42P01 missing FROM-clause entry)'
    );
  });
});
