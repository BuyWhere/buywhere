import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// Regression for BUY-67626: mobile hero search control fragmentation.
// The search input, country selector, and submit button must read as one
// composite control group on narrow viewports: shared height, shared border
// weight, and visually coherent backgrounds.

const SOURCE = 'src/components/HomeProductSearch.tsx';

async function loadSource() {
  return readFile(SOURCE, 'utf8');
}

test('search input + country + button share a unified border on mobile', async () => {
  const source = await loadSource();
  // Extract className strings for the three interactive controls.
  const inputClass = source.match(/className="search-input[^"]+"/)?.[0] ?? '';
  const selectClass = source.match(/<select[\s\S]*?className="[^"]+"/)?.[0] ?? '';
  const buttonClass = source.match(/type="submit"\s+className="[^"]+"/)?.[0] ?? '';

  assert.ok(inputClass.includes('border-2'), 'search input must declare border-2');
  assert.ok(inputClass.includes('border-white/50'), 'search input must use the shared border color');
  assert.ok(inputClass.includes('h-[60px]'), 'search input must declare explicit mobile height');
  assert.ok(inputClass.includes('sm:h-[66px]'), 'search input height must scale to sm breakpoint');

  assert.ok(selectClass.includes('border-2'), 'country select must declare border-2');
  assert.ok(selectClass.includes('border-white/50'), 'country select must use the shared border color');
  assert.ok(selectClass.includes('h-[60px]'), 'country select must declare explicit mobile height');
  assert.ok(selectClass.includes('sm:h-[66px]'), 'country select height must scale to sm breakpoint');

  assert.ok(buttonClass.includes('border-2'), 'submit button must declare border-2');
  assert.ok(buttonClass.includes('border-transparent'), 'submit button must declare a transparent default border to match group thickness');
  assert.ok(buttonClass.includes('focus:border-white'), 'submit button must light its border to the shared color on focus');
});

test('search input and country select share a solid dark background on mobile', async () => {
  const source = await loadSource();
  const inputClass = source.match(/className="search-input[^"]+"/)?.[0] ?? '';
  const selectClass = source.match(/<select[\s\S]*?className="[^"]+"/)?.[0] ?? '';

  assert.ok(inputClass.includes('bg-indigo-950'), 'search input must use solid dark bg-indigo-950');
  assert.ok(selectClass.includes('bg-indigo-950'), 'country select must match input with solid bg-indigo-950 (was bg-white/10 — fragmented)');
  assert.ok(!selectClass.includes('bg-white/10'), 'country select must NOT use translucent bg-white/10 anymore');
  assert.ok(!selectClass.includes('bg-white/20'), 'country select focus bg must NOT shift to bg-white/20');
});

test('submit button keeps the primary CTA white background but visually belongs to the group', async () => {
  const source = await loadSource();
  const buttonClass = source.match(/type="submit"\s+className="[^"]+"/)?.[0] ?? '';

  assert.ok(buttonClass.includes('bg-white'), 'submit button must keep solid white CTA background');
  assert.ok(buttonClass.includes('h-[60px]'), 'submit button must share the unified mobile height');
  assert.ok(buttonClass.includes('sm:h-[66px]'), 'submit button height must scale to sm breakpoint');
  assert.ok(buttonClass.includes('focus:border-white'), 'submit button focus border must align with input/country');
});
