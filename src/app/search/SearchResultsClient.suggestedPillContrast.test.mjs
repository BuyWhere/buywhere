// BUY-68744 regression test: suggested-search pill colors must be WCAG-AAA
// compliant (>=7:1) so VidMee doesn't reopen the contrast ticket again.
// Locks in slate-100 background + slate-900 text (16.30:1 ratio).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, 'SearchResultsClient.tsx'), 'utf8');

function srgbToLin(c) {
  c = c / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}

function contrast(fg, bg) {
  const L1 = luminance(fg);
  const L2 = luminance(bg);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

test('BUY-68744: Suggested pills use slate-900 text on slate-100 background', () => {
  const ratio = contrast('#0F172A', '#F1F5F9'); // slate-900 on slate-100
  assert.ok(
    ratio >= 7.0,
    `Expected WCAG-AAA contrast (>=7:1), got ${ratio.toFixed(2)}:1`
  );
});

test('BUY-68744: suggested-pill block in source uses slate classes (not amber)', () => {
  // Find the Suggested: span block and assert the pill className is slate,
  // not amber. This is the regression guard.
  const idx = source.indexOf('Suggested:');
  assert.ok(idx > 0, 'Suggested: span not found in SearchResultsClient.tsx');
  const block = source.slice(idx, idx + 600);
  assert.ok(
    !block.includes('bg-amber-'),
    `Suggested pill block still contains amber background: ${block.slice(0, 200)}`
  );
  assert.ok(
    !block.includes('text-amber-'),
    `Suggested pill block still contains amber text: ${block.slice(0, 200)}`
  );
  assert.ok(
    block.includes('bg-slate-100') && block.includes('text-slate-900'),
    'Suggested pill block must use bg-slate-100 + text-slate-900'
  );
});
