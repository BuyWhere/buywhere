/**
 * VidMee QA 4-field intake gate — BUY-71466 / BUY-71048 / BUY-70779 RFC
 *
 * RFC-required fields per contrast/placeholder/broken-image flag:
 *   1. renderedEvidence  — literal DOM snippet or computed CSS selector for the flagged element.
 *   2. runContext        — VidMee run timestamp + live deploy SHA / deploy time.
 *   3. batchRowIndex     — row index in the QA batch (document base).
 *   4. computedTokens    — actual text-* / bg-* / color token pair or resolved color pair.
 *
 * Intake gate rule:
 *   If ANY of the four fields is missing, empty, or only an opaque asset hash,
 *   downgrade to an informational comment on the original issue instead of
 *   triggering a reopen.
 *
 * Usage:
 *   import { runIntakeGate } from './vidmee-qa-intake.mjs';
 *   const { reopen, downgrade } = runIntakeGate(issues, vidmeeResult);
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Check whether a value is a meaningful field (non-empty, non-opaque-hash).
 * An opaque asset hash is any 8-64 char lowercase hex string.
 * @param {unknown} val
 * @returns {boolean}
 */
function hasMeaningfulValue(val) {
  if (val === undefined || val === null) return false;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return false;
    // Reject bare opaque hashes (8-64 lowercase hex chars, no other chars)
    if (/^[a-f0-9]{8,64}$/.test(trimmed)) return false;
    return true;
  }
  // Object/array is meaningful if non-empty
  if (typeof val === 'object') return Object.keys(val).length > 0;
  return true;
}

/**
 * Validate all four RFC-required fields on a single VidMee issue/flag.
 * Returns { valid, missingFields }.
 * @param {object} issue  — parsed VidMee issue object
 * @returns {{ valid: boolean, missingFields: string[] }}
 */
export function validateIssueFields(issue) {
  const required = ['renderedEvidence', 'runContext', 'batchRowIndex', 'computedTokens'];
  const missingFields = required.filter(field => !hasMeaningfulValue(issue[field]));
  return { valid: missingFields.length === 0, missingFields };
}

/**
 * Classify a VidMee issue by category for intake purposes.
 * Only contrast / placeholder / broken-image issues are subject to the 4-field gate.
 * @param {object} issue
 * @returns {'contrast'|'placeholder'|'broken-image'|'other'}
 */
export function classifyIssueCategory(issue) {
  const category = (issue.category || '').toLowerCase();
  const title   = (issue.title   || '').toLowerCase();
  const axeRule = (issue.evidence?.axe_rule || '').toLowerCase();

  if (
    category === 'color' ||
    axeRule === 'color-contrast' ||
    title.includes('contrast') ||
    title.includes('low-contrast')
  ) return 'contrast';
  if (
    title.includes('placeholder') ||
    title.includes('empty') ||
    category === 'placeholder' ||
    (issue.dom_selector && issue.dom_selector.includes('placeholder'))
  ) return 'placeholder';
  if (
    title.includes('broken') ||
    title.includes('missing image') ||
    title.includes('404') ||
    category === 'broken-image'
  ) return 'broken-image';
  return 'other';
}

/**
 * Determine whether a VidMee issue should trigger a reopen or be downgraded
 * to an informational comment.
 *
 * Gate logic:
 *   - contrast / placeholder / broken-image issues → require all 4 RFC fields
 *   - other issue categories → pass through (not subject to this gate)
 *
 * @param {object} issue  — parsed VidMee issue object
 * @returns {{ action: 'reopen'|'downgrade'|'pass-through', reason?: string, missingFields?: string[] }}
 */
export function gateIssue(issue) {
  const category = classifyIssueCategory(issue);

  // Only apply the 4-field gate to contrast/placeholder/broken-image
  if (category === 'other') {
    return { action: 'pass-through' };
  }

  const { valid, missingFields } = validateIssueFields(issue);

  if (valid) {
    return { action: 'reopen', reason: `All 4 RFC fields present (category: ${category})` };
  }

  return {
    action: 'downgrade',
    reason: `Missing required RFC fields: ${missingFields.join(', ')} (category: ${category})`,
    missingFields,
  };
}

/**
 * Process the full output of a `vidmee inspect` run through the intake gate.
 *
 * @param {object} vidmeeResult   — parsed JSON from `vidmee inspect <url>`
 * @param {string[]} [options.contrastSelectors]  — BUY-70779 selector set for re-run validation
 * @returns {{ reopen: object[], downgrade: object[], passThrough: object[], gateSummary: object }}
 */
export function runIntakeGate(vidmeeResult, options = {}) {
  const issues = vidmeeResult.issues || [];
  const reopen      = [];
  const downgrade   = [];
  const passThrough = [];

  for (const issue of issues) {
    const result = gateIssue(issue);
    if (result.action === 'reopen') {
      reopen.push({ ...issue, _gate: result });
    } else if (result.action === 'downgrade') {
      downgrade.push({ ...issue, _gate: result });
    } else {
      passThrough.push({ ...issue, _gate: result });
    }
  }

  const gateSummary = {
    total:            issues.length,
    reopen:           reopen.length,
    downgrade:        downgrade.length,
    passThrough:      passThrough.length,
    reRunSelectors:   options.contrastSelectors || null,
  };

  return { reopen, downgrade, passThrough, gateSummary };
}

/**
 * Build the 4-field enriched evidence block for a VidMee issue.
 * This is the shape the reopen automation should emit alongside the flag.
 *
 * @param {object} issue        — raw VidMee issue
 * @param {string} runTimestamp — ISO timestamp of the VidMee run
 * @param {string} deploySha    — git SHA of the live deploy
 * @param {string} deployTime   — deploy timestamp (ISO or human-readable)
 * @param {number} rowIndex     — batch row index (0-based)
 * @param {object} colorTokens  — { foreground, background } with token names + hex
 * @returns {object} enriched evidence block
 */
/**
 * Parse raw VidMee stdout that may have leading/trailing whitespace or partial JSON.
 * Falls back to extracting the "issues" array from the raw stdout string.
 * @param {string} rawStdout
 * @returns {{ issues: object[] } | null}
 */
export function parseRawIssues(rawStdout) {
  if (!rawStdout || typeof rawStdout !== 'string') return null;
  const trimmed = rawStdout.trim();
  if (!trimmed) return null;

  // Try direct parse first
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && Array.isArray(parsed.issues)) return parsed;
  } catch {
    // Not JSON directly — try extracting issues array
  }

  // Try to find and parse just the issues array
  const issuesMatch = trimmed.match(/"issues"\s*:\s*\[/);
  if (issuesMatch) {
    // Find the opening bracket and matching close
    const startIdx = issuesMatch.index + issuesMatch[0].length - 1;
    let depth = 1;
    let endIdx = startIdx + 1;
    while (depth > 0 && endIdx < trimmed.length) {
      if (trimmed[endIdx] === '[') depth++;
      else if (trimmed[endIdx] === ']') depth--;
      endIdx++;
    }
    if (depth === 0) {
      try {
        const issues = JSON.parse(trimmed.slice(startIdx, endIdx));
        return { issues };
      } catch {
        // Extraction failed
      }
    }
  }

  // Last resort: try extracting JSON from anywhere in the string
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && Array.isArray(parsed.issues)) return parsed;
    } catch {
      // Extraction failed
    }
  }

  // Tolerate malformed JSON emitted by VidMee (e.g. raw newlines inside strings)
  // by extracting the issue fields we need for the intake gate.
  const rawIssueBlocks = trimmed.split(/\n\s*\{\n\s*"id"\s*:\s*"issue_/).slice(1);
  if (rawIssueBlocks.length > 0) {
    const issues = rawIssueBlocks.map((block, idx) => {
      const source = `{\n  "id": "issue_${block}`;
      const pick = (name) => {
        const match = source.match(new RegExp(`"${name}"\\s*:\\s*"([^"\\n]*)"`));
        return match ? match[1] : null;
      };
      const pickEvidence = (name) => {
        const match = source.match(new RegExp(`"${name}"\\s*:\\s*(?:"([^"\\n]*)"|null)`));
        return match ? (match[1] ?? null) : null;
      };
      return {
        id: pick('id') || `issue_${idx + 1}`,
        title: pick('title') || '',
        category: pick('category') || '',
        severity: pick('severity') || '',
        description: pick('description') || '',
        fingerprint: pick('fingerprint') || '',
        evidence: {
          axe_rule: pickEvidence('axe_rule'),
          dom_selector: pickEvidence('dom_selector'),
          console_error: pickEvidence('console_error'),
        },
        _parseWarning: 'Recovered from malformed VidMee JSON; gate treats missing RFC fields as insufficient evidence.',
      };
    });
    return { issues };
  }

  return null;
}

export function enrichIssue(issue, runTimestamp, deploySha, deployTime, rowIndex, colorTokens) {
  return {
    renderedEvidence: issue.evidence?.dom_selector
      ? {
          selector:  issue.evidence.dom_selector,
          snippet:   null,       // populated if DOM snippet extraction is wired
          screenshot: issue.evidence.screenshot_region
            ? { x: issue.evidence.screenshot_region.x,
                y: issue.evidence.screenshot_region.y,
                width:  issue.evidence.screenshot_region.width,
                height: issue.evidence.screenshot_region.height }
            : null,
        }
      : null,
    runContext: {
      vidmeeTimestamp:  runTimestamp,
      deploySha,
      deployTime,
    },
    batchRowIndex: rowIndex,
    computedTokens: colorTokens || null,
  };
}

// ── CLI entry-point ─────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , vidmeeJsonPath, batchIndexArg] = process.argv;

  if (!vidmeeJsonPath) {
    console.error('Usage: node vidmee-qa-intake.mjs <vidmee-output.json> [batchRowIndex]');
    process.exit(1);
  }

  const rowIndex   = batchIndexArg ? parseInt(batchIndexArg, 10) : 0;
  const vidmeeOut  = JSON.parse(readFileSync(vidmeeJsonPath, 'utf8'));
  const result     = runIntakeGate(vidmeeOut);

  console.log('\n=== VidMee QA Intake Gate Report ===');
  console.log(`Total issues : ${result.gateSummary.total}`);
  console.log(`→ reopen     : ${result.gateSummary.reopen}`);
  console.log(`→ downgrade  : ${result.gateSummary.downgrade}`);
  console.log(`→ pass-through: ${result.gateSummary.passThrough}`);
  console.log();

  if (result.downgrade.length > 0) {
    console.log('--- Downgraded (informational only) ---');
    for (const issue of result.downgrade) {
      console.log(`  [${issue.id}] ${issue.title.slice(0, 80)}…`);
      console.log(`    Missing: ${issue._gate.missingFields.join(', ')}`);
    }
    console.log();
  }

  if (result.reopen.length > 0) {
    console.log('--- Ready to reopen ---');
    for (const issue of result.reopen) {
      console.log(`  [${issue.id}] ${issue.title.slice(0, 80)}…`);
    }
    console.log();
  }

  process.exit(result.gateSummary.reopen > 0 ? 0 : 0); // always exit 0; caller decides
}
