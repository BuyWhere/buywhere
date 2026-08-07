import { test, expect, request } from '@playwright/test';

/**
 * BUY-67036: regression test for the full Chrome RSC navigation request
 * shape (Next-Router-State-Tree + __PAGE__ searchParams).
 *
 * Pre-fix: full Chrome RSC nav on /search and /compare returned HTTP 500
 * because Next 14.2.35's route resolver trips a parser bug when the route
 * uses the legacy sync `searchParams` shape AND the request carries a
 * Next-Router-State-Tree header. The simple /search?_rsc=* prefetch
 * returns 200, but the navigation request — which Chrome sends during a
 * real route transition — used to return 500.
 *
 * Fix:
 *   - Convert /search and /compare to Promise-based searchParams (Next 15
 *     style). Awaiting the params Promise avoids the legacy code path.
 *   - force-dynamic + revalidate=0 so the server-side re-render does not
 *     depend on cached build output.
 *   - Per-route error.tsx boundaries so any future streaming failure
 *     surfaces a friendly retry UI instead of an opaque 500.
 *   - AffiliateLink hardened against 'window is not defined' when called
 *     during server-side pre-render of client components.
 *
 * The Next-Router-State-Tree value below is the URL-encoded JSON form of
 * the Next 14.2.35 FlightRouterState tuple:
 *   ["", {"children": ["(layout)", {"children": ["__PAGE__", {}, null,
 *     null, false]}], null, null, false]}, null, null, true]
 * Real Chrome constructs the same tuple at runtime.
 */

const RSC_STATE_TREE =
  '%5B%22%22%2C%20%7B%22children%22%3A%20%5B%22%28layout%29%22%2C%20%7B%22children%22%3A%20%5B%22__PAGE__%22%2C%20%7B%7D%2C%20null%2C%20null%2C%20false%5D%7D%2C%20null%2C%20null%2C%20false%5D%7D%2C%20null%2C%20null%2C%20true%5D';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

test.describe('BUY-67036 RSC navigation requests', () => {
  test('/search full Chrome RSC nav returns 200', async ({ baseURL }) => {
    const ctx = await request.newContext({
      baseURL,
      extraHTTPHeaders: {
        'User-Agent': CHROME_UA,
        Accept: 'text/x-component',
        RSC: '1',
        'Next-Router-State-Tree': RSC_STATE_TREE,
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
        RSC: '1',
        'Next-Router-State-Tree': RSC_STATE_TREE,
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
        RSC: '1',
      },
    });
    const response = await ctx.get('/search?q=laptop&_rsc=test');
    expect(response.status()).toBe(200);
    await ctx.dispose();
  });

  test('/compare simple RSC prefetch still returns 200', async ({ baseURL }) => {
    const ctx = await request.newContext({
      baseURL,
      extraHTTPHeaders: {
        'User-Agent': CHROME_UA,
        Accept: 'text/x-component',
        RSC: '1',
      },
    });
    const response = await ctx.get('/compare?q=laptop&_rsc=test');
    expect(response.status()).toBe(200);
    await ctx.dispose();
  });
});