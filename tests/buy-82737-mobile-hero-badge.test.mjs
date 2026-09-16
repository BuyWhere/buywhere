import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const PAGE = 'src/app/page.tsx';

test('BUY-82737: homepage hero badge stacks on mobile and keeps footer copy padded', async () => {
  const source = await readFile(PAGE, 'utf8');
  const badgeStart = source.indexOf('hero-badge');
  assert.ok(badgeStart >= 0, 'homepage must keep the stats hero-badge');
  const badgeBlock = source.slice(badgeStart, badgeStart + 900);

  assert.match(badgeBlock, /\bflex-col\b/, 'badge must stack below sm');
  assert.match(badgeBlock, /\bsm:flex-row\b/, 'badge must sit in a row from sm up');
  assert.match(badgeBlock, /max-w-\[20rem\]/, 'badge must cap width on mobile so 360–390px viewports do not overflow');
  assert.match(source, /pt-16 pb-28/, 'hero shell must keep extra mobile bottom padding so footer copy is not clipped');
  assert.match(source, /mt-8 pb-10/, 'hero footer copy wrapper must include pb-10');
  assert.match(source, /Live product comparisons updated daily/);
});
