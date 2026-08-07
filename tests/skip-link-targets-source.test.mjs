import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const routes = [
  { path: '/', file: 'src/app/page.tsx' },
  { path: '/compare', file: 'src/app/compare/page.tsx' },
  { path: '/api-keys', file: 'src/app/api-keys/page.tsx' },
  { path: '/partners', file: 'src/app/partners/page.tsx' },
  { path: '/challenge', file: 'src/app/challenge/page.tsx' },
  { path: '/blog', file: 'src/app/blog/page.tsx' },
];

test('public routes that render the skip link define exactly one main-content target', async () => {
  for (const route of routes) {
    const source = await readFile(route.file, 'utf8');
    const matches = source.match(/id=["']main-content["']/g) ?? [];
    assert.equal(matches.length, 1, `${route.path} should define exactly one #main-content target`);
  }
});

test('global skip link and nav target stay paired with route main-content targets', async () => {
  const layout = await readFile('src/app/layout.tsx', 'utf8');
  const skipLinks = await readFile('src/components/SkipLinks.tsx', 'utf8');
  const nav = await readFile('src/components/Nav.tsx', 'utf8');

  assert.match(layout, /<SkipLinks\s*\/>/, 'root layout should render SkipLinks globally');
  assert.match(skipLinks, /href=["']#main-content["']/, 'SkipLinks should target #main-content');
  assert.match(nav, /id=["']main-navigation["']/, 'Nav should expose #main-navigation target');
});

test('new secondary route main-content targets are programmatically focusable', async () => {
  for (const route of routes.filter(({ path }) => ['/compare', '/api-keys', '/partners'].includes(path))) {
    const source = await readFile(route.file, 'utf8');
    assert.match(
      source,
      /<main\s+id=["']main-content["']\s+tabIndex=\{-1\}/,
      `${route.path} #main-content target should receive focus after skip-link activation`,
    );
  }
});
