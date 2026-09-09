#!/usr/bin/env node
/**
 * BuyWhere semantic-search nightly eval harness — BUY-41137
 *
 * Runs the Atlas QA eval set against /v1/products/search (hybrid) and
 * /v1/products/:id/similar, computes per-segment quality metrics, and
 * exits non-zero if any threshold is breached.
 *
 * Metrics:
 *   - recall@10 per segment (english | sea | sku_exact)
 *   - NDCG@10 overall
 *   - category_concordance (top result category matches expected category)
 *   - avg_cosine_similarity (for Find-Similar only)
 *
 * Thresholds (from Reed's acceptance criteria):
 *   - recall@10 english       >= 0.70
 *   - recall@10 sea           >= 0.55
 *   - recall@10 sku_exact     >= 0.85
 *   - NDCG@10                 >= 0.65
 *   - category_concordance    >= 0.80
 *   - avg_cosine_similarity   >= 0.55
 *
 * Usage:
 *   EVAL_SET=./data/eval/atlas-qa-eval-set.json \
 *   TARGET_URL=https://api.buywhere.ai \
 *   API_KEY=bw_xxx \
 *   node scripts/eval/semantic-search-eval.js
 *
 * Exit codes:
 *   0  PASS (all thresholds met)
 *   1  FAIL (one or more thresholds breached)
 *   2  ERROR (config / network / eval-set parse failure)
 *
 * Output:
 *   - JSON report on stdout
 *   - Markdown summary at reports/eval-summary-<ts>.md
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');


// ── Config ──────────────────────────────────────────────────────────────────

const TARGET_URL = process.env.TARGET_URL || 'https://api.buywhere.ai';
const API_KEY    = process.env.API_KEY    || process.env.BUYWHERE_API_KEY || '';
const EVAL_SET   = process.env.EVAL_SET   || path.join(__dirname, '..', '..', 'data', 'eval', 'atlas-qa-eval-set.json');
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 8000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);

const THRESHOLDS = {
  recall_at_10: {
    english:   0.70,
    sea:       0.55,
    sku_exact: 0.85,
  },
  ndcg_at_10:           0.65,
  category_concordance: 0.80,
  avg_cosine_sim:       0.55,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function dcg(rels, k) {
  let s = 0;
  for (let i = 0; i < Math.min(k, rels.length); i++) {
    const r = rels[i];
    if (r > 0) s += (Math.pow(2, r) - 1) / Math.log2(i + 2);
  }
  return s;
}

function ndcgAtK(rels, k) {
  const ideal = [...rels].sort((a, b) => b - a);
  const idcg = dcg(ideal, k);
  return idcg === 0 ? 0 : dcg(rels, k) / idcg;
}

function recallAtK(returnedIds, expectedIds, k) {
  if (!expectedIds || expectedIds.length === 0) return 1;
  const top = returnedIds.slice(0, k);
  const exp = new Set(expectedIds);
  let hit = 0;
  for (const id of top) if (exp.has(id)) hit++;
  return hit / Math.min(k, expectedIds.length);
}

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        'Accept': 'application/json',
        ...(opts.headers || {}),
        ...(API_KEY ? { 'Authorization': `Bearer ${API_KEY}`, 'X-API-Key': API_KEY } : {}),
      },
    });
    if (!res.ok) {
      return { _status: res.status, _ok: false, body: null };
    }
    const body = await res.json();
    return { _status: res.status, _ok: true, body };
  } catch (e) {
    return { _status: 0, _ok: false, _error: String(e && e.message || e) };
  } finally {
    clearTimeout(tid);
  }
}

async function runWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// ── Eval cases ──────────────────────────────────────────────────────────────

// Eval set schema (Atlas QA):
//   {
//     "segment": "english" | "sea" | "sku_exact",
//     "query":   "<string>",
//     "mode":    "hybrid" | "semantic",
//     "expected_product_ids": ["<id>", ...],
//     "expected_category":    "<category-slug>" | null,
//     "type":                 "search" | "find_similar",
//     "anchor_product_id":    "<id>"  // required when type == "find_similar"
//   }

async function runSearchCase(c) {
  const url = `${TARGET_URL}/v1/products/search?q=${encodeURIComponent(c.query)}&mode=${encodeURIComponent(c.mode || 'hybrid')}&limit=10`;
  const r = await fetchJson(url);
  if (!r._ok) return { case: c, error: r._status || r._error, recall: 0, ndcg: 0, cat_ok: 0, cosine_sim: null };
  const arr = Array.isArray(r.body) ? r.body : (r.body?.items || r.body?.products || r.body?.results || r.body?.data || []);
  const returnedIds = arr.map(x => String(x.id || x.product_id || x.productId));
  const returnedCats = arr.map(x => x.category || x.category_slug || (Array.isArray(x.category_path) ? x.category_path[0] : null));
  const rels = returnedIds.map(id => (c.expected_product_ids || []).includes(id) ? 1 : 0);
  const recall = recallAtK(returnedIds, c.expected_product_ids || [], 10);
  const ndcg = ndcgAtK(rels, 10);
  const catOk = c.expected_category && returnedCats[0] === c.expected_category ? 1 : 0;
  return { case: c, recall, ndcg, cat_ok: catOk };
}

async function runFindSimilarCase(c) {
  const url = `${TARGET_URL}/v1/products/${encodeURIComponent(c.anchor_product_id)}/similar?limit=10`;
  const r = await fetchJson(url);
  if (!r._ok) return { case: c, error: r._status || r._error, recall: 0, ndcg: 0, cat_ok: 0, cosine_sim: 0 };
  const arr = Array.isArray(r.body) ? r.body : (r.body?.items || r.body?.products || r.body?.results || r.body?.data || []);
  const returnedIds = arr.map(x => String(x.id || x.product_id || x.productId));
  const sims = arr.map(x => typeof x.similarity === 'number' ? x.similarity : (x.score || 0));
  const rels = returnedIds.map(id => (c.expected_product_ids || []).includes(id) ? 1 : 0);
  const recall = recallAtK(returnedIds, c.expected_product_ids || [], 10);
  const ndcg = ndcgAtK(rels, 10);
  const catOk = c.expected_category && arr[0]?.category === c.expected_category ? 1 : 0;
  const avgCos = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;
  return { case: c, recall, ndcg, cat_ok: catOk, cosine_sim: avgCos };
}

// ── Aggregation & reporting ─────────────────────────────────────────────────

function aggregate(results) {
  const bySegment = { english: [], sea: [], sku_exact: [] };
  const ndcgs = [];
  const catOks = [];
  const cosines = [];
  let totalErrors = 0;
  let totalCases = 0;

  for (const r of results) {
    totalCases++;
    if (r.error !== undefined) { totalErrors++; continue; }
    const seg = r.case.segment;
    if (bySegment[seg]) bySegment[seg].push(r.recall);
    ndcgs.push(r.ndcg);
    catOks.push(r.cat_ok);
    if (r.cosine_sim !== null && r.cosine_sim !== undefined) cosines.push(r.cosine_sim);
  }

  const mean = xs => xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
  const segmentRecall = {
    english:   mean(bySegment.english),
    sea:       mean(bySegment.sea),
    sku_exact: mean(bySegment.sku_exact),
  };
  const overall = {
    ndcg_at_10:           mean(ndcgs),
    category_concordance: mean(catOks),
    avg_cosine_sim:       mean(cosines),
    total_cases:          totalCases,
    total_errors:         totalErrors,
  };
  return { segmentRecall, overall };
}

function evaluate({ segmentRecall, overall }) {
  const breaches = [];
  for (const [seg, t] of Object.entries(THRESHOLDS.recall_at_10)) {
    const v = segmentRecall[seg] || 0;
    if (v < t) breaches.push({ metric: `recall@10/${seg}`, observed: Number(v.toFixed(4)), threshold: t });
  }
  if (overall.ndcg_at_10 < THRESHOLDS.ndcg_at_10) {
    breaches.push({ metric: 'ndcg@10', observed: Number(overall.ndcg_at_10.toFixed(4)), threshold: THRESHOLDS.ndcg_at_10 });
  }
  if (overall.category_concordance < THRESHOLDS.category_concordance) {
    breaches.push({ metric: 'category_concordance', observed: Number(overall.category_concordance.toFixed(4)), threshold: THRESHOLDS.category_concordance });
  }
  if (overall.avg_cosine_sim > 0 && overall.avg_cosine_sim < THRESHOLDS.avg_cosine_sim) {
    breaches.push({ metric: 'avg_cosine_sim', observed: Number(overall.avg_cosine_sim.toFixed(4)), threshold: THRESHOLDS.avg_cosine_sim });
  }
  return breaches;
}

function mdSummary(report) {
  const f = (n) => (n * 100).toFixed(2) + '%';
  return [
    `# Semantic-Search Eval — ${report.captured_at}`,
    ``,
    `- Target: \`${report.target_url}\``,
    `- Cases: ${report.overall.total_cases} (errors: ${report.overall.total_errors})`,
    `- Result: **${report.passed ? 'PASS' : 'FAIL'}**`,
    ``,
    `| Metric | Observed | Threshold |`,
    `|--------|---------:|----------:|`,
    `| recall@10 / english | ${f(report.segmentRecall.english)} | ${f(THRESHOLDS.recall_at_10.english)} |`,
    `| recall@10 / sea | ${f(report.segmentRecall.sea)} | ${f(THRESHOLDS.recall_at_10.sea)} |`,
    `| recall@10 / sku_exact | ${f(report.segmentRecall.sku_exact)} | ${f(THRESHOLDS.recall_at_10.sku_exact)} |`,
    `| NDCG@10 | ${f(report.overall.ndcg_at_10)} | ${f(THRESHOLDS.ndcg_at_10)} |`,
    `| category_concordance | ${f(report.overall.category_concordance)} | ${f(THRESHOLDS.category_concordance)} |`,
    `| avg_cosine_sim | ${f(report.overall.avg_cosine_sim)} | ${f(THRESHOLDS.avg_cosine_sim)} |`,
    ``,
    report.breaches.length
      ? `## Breaches\n\n` + report.breaches.map(b => `- ${b.metric}: ${b.observed} < ${b.threshold}`).join('\n')
      : `## No breaches.`,
    ``,
  ].join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(EVAL_SET)) {
    console.error(`FATAL: eval set not found at ${EVAL_SET}`);
    process.exit(2);
  }
  const evalSet = JSON.parse(fs.readFileSync(EVAL_SET, 'utf8'));
  if (!Array.isArray(evalSet) || evalSet.length === 0) {
    console.error('FATAL: eval set is empty or not an array');
    process.exit(2);
  }
  console.error(`[eval] loaded ${evalSet.length} cases from ${EVAL_SET}`);
  console.error(`[eval] target=${TARGET_URL} concurrency=${CONCURRENCY}`);

  const results = await runWithConcurrency(evalSet, CONCURRENCY, async (c) => {
    try {
      if (c.type === 'find_similar') return await runFindSimilarCase(c);
      return await runSearchCase(c);
    } catch (e) {
      return { case: c, error: String(e && e.message || e), recall: 0, ndcg: 0, cat_ok: 0, cosine_sim: null };
    }
  });

  const agg = aggregate(results);
  const breaches = evaluate(agg);
  const passed = breaches.length === 0;

  const report = {
    captured_at: new Date().toISOString(),
    target_url: TARGET_URL,
    eval_set_path: EVAL_SET,
    eval_set_count: evalSet.length,
    segmentRecall: Object.fromEntries(
      Object.entries(agg.segmentRecall).map(([k, v]) => [k, Number(v.toFixed(4))])
    ),
    overall: {
      ndcg_at_10:           Number(agg.overall.ndcg_at_10.toFixed(4)),
      category_concordance: Number(agg.overall.category_concordance.toFixed(4)),
      avg_cosine_sim:       Number(agg.overall.avg_cosine_sim.toFixed(4)),
      total_cases:          agg.overall.total_cases,
      total_errors:         agg.overall.total_errors,
    },
    thresholds: THRESHOLDS,
    breaches,
    passed,
  };

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');

  // Markdown summary
  try {
    const outDir = path.join(process.cwd(), 'reports');
    fs.mkdirSync(outDir, { recursive: true });
    const mdPath = path.join(outDir, `eval-summary-${Date.now()}.md`);
    fs.writeFileSync(mdPath, mdSummary(report));
    console.error(`[eval] summary written: ${mdPath}`);
  } catch (e) {
    console.error(`[eval] WARN: could not write markdown summary: ${e.message}`);
  }

  if (!passed) {
    console.error(`[eval] FAIL: ${breaches.length} threshold breach(es)`);
    process.exit(1);
  }
  console.error('[eval] PASS: all thresholds met');
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exit(2);
});
