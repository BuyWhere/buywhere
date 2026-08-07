import { test, expect, request } from '@playwright/test';

/**
 * BUY-67036: regression test for the full Chrome RSC navigation request
 * shape (Next-Router-State-Tree + __PAGE__ searchParams). The simple
 * /search?_rsc=* prefetch returns 200, but the navigation request —
 * which Chrome sends during a real route transition — used to return
 * 500 because streaming Suspense + generateMetadata that reads
 * searchParams + dynamic data trips the streaming pass against
 * state-tree-derived params. force-dynamic + error.tsx fix it.
 */

const SEARCH_STATE_TREE =
  '%5B%22%22%2C%7B%22children%22%3A%5B%22%28layout%29%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%22q%22%3A%22gaming%20laptop%22%2C%22country%22%3A%22us%22%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D';

const COMPARE_STATE_TREE =
  '%5B%22%22%2C%7B%22children%22%3A%5B%22%28layout%29%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%22q%22%3A%22gaming%20laptop%22%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

test.describe('BUY-67036 RSC navigation requests', () => {
  test('/search full Chrome RSC nav returns 200', async ({ baseURL }) => {
    const ctx = await request.newContext({
      baseURL,
      extraHTTPHeaders: {
        'User-Agent': CHROME_UA,
        Accept: 'text/x-component',
        'RSC': '1',
        'Next-Router-State-Tree': SEARCH_STATE_TREE,
      },
    });
    const response = await ctx.get('/search?q=gaming%20laptop&country=us');
    expect(response.status()).toBe(200);
    await ctx.dispose();
  });

  test('/compare full Chrome RSC nav returns 200', async ({ baseURL }) => {
    const ctx = await request.newContext({
      baseURL,
      extraHTTPHeaders: {
        'User-Agent': CHROME_UA,
        Accept: 'text/x-component',
        'RSC': '1',
        'Next-Router-State-Tree': COMPARE_STATE_TREE,
      },
    });
    const response = await ctx.get('/compare?q=gaming%20laptop');
    expect(response.status()).toBe(200);
    await ctx.dispose();
  });

  test('/search simple RSC prefetch still returns 200', async ({ baseURL }) => {
    const ctx = await request.newContext({
      baseURL,
      extraHTTPHeaders: {
        'User-Agent': CHROME_UA,
        Accept: 'text/x-component',
        'RSC': '1',
      },
    });
    const response = await ctx.get('/search?q=laptop&_rsc=test');
    expect(response.status()).toBe(200);
    await ctx.dispose();
  });
});