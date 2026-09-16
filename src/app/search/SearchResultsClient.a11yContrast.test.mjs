// BUY-82741: country eyebrow contrast + labeled compare icon on search cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const searchSource = readFileSync(resolve(here, 'SearchResultsClient.tsx'), 'utf8');
const compareSource = readFileSync(
  resolve(here, '../../components/compare/CompareSelectButton.tsx'),
  'utf8'
);

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

test('BUY-82741: #8a4b08 on white meets WCAG AA 4.5:1 for small text', () => {
  const ratio = contrast('#8a4b08', '#ffffff');
  assert.ok(ratio >= 4.5, `got ${ratio.toFixed(2)}:1`);
});

test('BUY-82741: country / eyebrow copy uses #8a4b08, not text-amber-700', () => {
  assert.match(searchSource, /activeCountry\.label\.toUpperCase\(\)/);
  const mobileIdx = searchSource.indexOf('activeCountry.label.toUpperCase()');
  const mobileBlock = searchSource.slice(Math.max(0, mobileIdx - 180), mobileIdx + 80);
  assert.ok(mobileBlock.includes('text-[#8a4b08]'), mobileBlock);

  const desktopIdx = searchSource.indexOf('{activeCountry.label}');
  assert.ok(desktopIdx > 0);
  const desktopBlock = searchSource.slice(Math.max(0, desktopIdx - 200), desktopIdx);
  assert.ok(desktopBlock.includes('text-[#8a4b08]'), desktopBlock);
});

test('BUY-82741: compare icon button is named (aria-label + title) and BEM-hooked', () => {
  assert.match(compareSource, /product-card__action-btn/);
  assert.match(compareSource, /aria-label=\{label\}/);
  assert.match(compareSource, /title=\{label\}/);
  assert.match(compareSource, /Add \$\{product\.name\} to compare/);
});
