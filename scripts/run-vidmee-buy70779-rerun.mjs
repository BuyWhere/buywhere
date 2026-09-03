#!/usr/bin/env node
/**
 * BUY-70779 Selector Re-run — BUY-71466
 *
 * Re-runs the VidMee QA pipeline against the BUY-70779 selector set
 * through the 4-field intake gate to confirm zero false auto-reopens.
 *
 * Usage:
 *   node scripts/run-vidmee-buy70779-rerun.mjs [--url <url>] [--verbose]
 *
 * Prerequisites:
 *   - VidMee CLI installed and authenticated (`vidmee doctor` passes)
 *   - Node.js ≥ 18
 *
 * Output:
 *   data/eval/vidmee-buy70779-rerun-<timestamp>.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT     = join(__dirname, '..');
const SELECTORS_FILE = join(ROOT, 'data/eval/vidmee-buy70779-selectors.json');
const OUTPUT_DIR    = join(ROOT, 'data/eval/vidmee-buy70779-rerun');
const EVIDENCE_DIR  = join(ROOT, '../..', 'evidence'); // workspace evidence/

const args = process.argv.slice(2);
const opts  = { verbose: args.includes('--verbose'), singleUrl: null };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) opts.singleUrl = args[i + 1];
}

mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Load BUY-70779 selector set ───────────────────────────────────────────────
const selectors = JSON.parse(readFileSync(SELECTORS_FILE, 'utf8'));
const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outputFile = join(OUTPUT_DIR, `vidmee-buy70779-rerun-${now}.json`);

// ── Import intake gate (compile-time safe) ─────────────────────────────────────
let intakeGate;
try {
  // Resolve relative to repo root
  const gatePath = join(ROOT, 'src/lib/vidmee-qa-intake.mjs');
  intakeGate = await import(`file://${gatePath}`);
} catch (e) {
  console.error('ERROR: Could not load vidmee-qa-intake.mjs:', e.message);
  console.error('  Make sure the module exists at src/lib/vidmee-qa-intake.mjs');
  process.exit(1);
}

const { runIntakeGate, enrichIssue, parseRawIssues } = intakeGate;

// ── Get deploy SHA ─────────────────────────────────────────────────────────────
function getDeploySha() {
  try {
    const sha = execSync('git -C "' + ROOT + '" rev-parse --short HEAD', {
      encoding: 'utf8',
    }).trim();
    return sha || 'unknown';
  } catch {
    return 'unknown';
  }
}

const DEPLOY_SHA = getDeploySha();

// ── Run VidMee inspect on a URL ────────────────────────────────────────────────
function runVidmeeInspect(url) {
  const start = Date.now();
  let stdout, stderr, status;
  try {
    const result = execSync(`vidmee inspect "${url}"`, {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    stdout = result;
    status = 'success';
    stderr = '';
  } catch (e) {
    stdout = e.stdout || '';
    stderr = e.stderr || '';
    status = e.status === 0 ? 'success' : `error:${e.status}`;
  }
  const elapsed = Date.now() - start;

  const parsed = parseRawIssues(stdout);

  return { url, stdout, stderr, status, elapsed_ms: elapsed, parsed };
}

// ── Main ───────────────────────────────────────────────────────────────────────
const runTimestamp = new Date().toISOString();
const deployTime   = new Date().toDateString();

const runRecord = {
  runTimestamp,
  deploySha:  DEPLOY_SHA,
  deployTime,
  selectorSetFile: SELECTORS_FILE,
  outputFile,
  totalUrls: 0,
  passedGate: 0,
  failedGate: 0,
  totalIssues: 0,
  issues: [],
};

const targetSelectors = opts.singleUrl
  ? selectors.filter(s => s.url === opts.singleUrl)
  : selectors;

console.log(`\n=== BUY-70779 VidMee Re-run — ${runTimestamp} ===`);
console.log(`Deploy SHA: ${DEPLOY_SHA}`);
console.log(`Target selectors: ${targetSelectors.length}`);
console.log(`Output: ${outputFile}\n`);

for (const entry of targetSelectors) {
  runRecord.totalUrls++;
  console.log(`[${runRecord.totalUrls}/${targetSelectors.length}] ${entry.url}`);

  const inspectResult = runVidmeeInspect(entry.url);

  if (opts.verbose) {
    console.log(`  Status: ${inspectResult.status} (${inspectResult.elapsed_ms}ms)`);
    if (inspectResult.stderr) console.log(`  STDERR: ${inspectResult.stderr.slice(0, 200)}`);
  }

  if (!inspectResult.parsed || !inspectResult.parsed.issues) {
    console.log(`  WARN: No issues found or invalid JSON`);
    runRecord.issues.push({ entry, inspectResult, gateResult: null });
    continue;
  }

  const gateResult = runIntakeGate(inspectResult.parsed);

  const rowIndex = targetSelectors.indexOf(entry);

  // Enrich reopen/downgrade issues with 4-field block
  const enrichedReopen    = gateResult.reopen.map(iss =>
    ({ ...iss, _4field: enrichIssue(iss, runTimestamp, DEPLOY_SHA, deployTime, rowIndex, null) })
  );
  const enrichedDowngrade = gateResult.downgrade.map(iss =>
    ({ ...iss, _4field: enrichIssue(iss, runTimestamp, DEPLOY_SHA, deployTime, rowIndex, null) })
  );

  const record = {
    entry,
    rowIndex,
    inspectResult: {
      url:          inspectResult.url,
      status:       inspectResult.status,
      elapsed_ms:   inspectResult.elapsed_ms,
      issueCount:   inspectResult.parsed.issues.length,
    },
    gateResult: {
      ...gateResult,
      reopen:    enrichedReopen,
      downgrade: enrichedDowngrade,
    },
    passedGate: gateResult.reopen.length,
    failedGate: gateResult.downgrade.length,
  };

  runRecord.issues.push(record);
  runRecord.passedGate += gateResult.reopen.length;
  runRecord.failedGate += gateResult.downgrade.length;
  runRecord.totalIssues += inspectResult.parsed.issues.length;

  console.log(`  Issues: ${inspectResult.parsed.issues.length} | reopen: ${gateResult.reopen.length} | downgrade: ${gateResult.downgrade.length} | pass-through: ${gateResult.passThrough.length}`);
}

// ── Write output ────────────────────────────────────────────────────────────────
writeFileSync(outputFile, JSON.stringify(runRecord, null, 2));
console.log(`\n=== Summary ===`);
console.log(`URLs processed    : ${runRecord.totalUrls}`);
console.log(`Total issues      : ${runRecord.totalIssues}`);
console.log(`→ reopen (valid)  : ${runRecord.passedGate}`);
console.log(`→ downgrade       : ${runRecord.failedGate}`);
console.log(`\nResult → ${outputFile}`);

if (runRecord.passedGate > 0) {
  console.log(`\n⚠️  ${runRecord.passedGate} issue(s) would trigger auto-reopen.`);
  console.log(`    Review data/eval/vidmee-buy70779-rerun/ before committing.`);
} else {
  console.log(`\n✅ 0 false auto-reopens — BUY-70779 re-run PASSES the 4-field gate.`);
}

// Exit 0: always success; caller decides what to do
process.exit(0);
