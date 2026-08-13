import { test, expect } from '@playwright/test';

/**
 * BUY-69260 — RSC navigation regression tests for /search and /compare.
 *
 * Chrome's app-router client sends `Next-Router-State-Tree` carrying a
 * populated `__PAGE__` segment during in-app navigation, e.g.
 *   ["", {"children": ["(layout)", {"children": ["__PAGE__", {"q":"...", "country":"..."}]}]}]
 * Next 14.2.35's router-state parser trips on the legacy sync `searchParams`
 * shape and returns HTTP 500 (`page: "/_error"`) instead of routing to the
 * route-local `error.tsx` boundary.
 *
 * MUST probe the POPULATED `__PAGE__` shape — not just the empty one — to
 * catch this failure mode. Per [[buywhere-rsc-nav-empty-page-false-success]]:
 * the empty `__PAGE__: {}` shape has been 200 since PR #379 but masks the
 * real failure. 5/5 populated-shape probes must be 200 for closure.
 */

const POPULATED_SEARCH =
  '%5B%22%22%2C%7B%22children%22%3A%5B%22%28layout%29%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%22q%22%3A%22gaming%20laptop%22%2C%22country%22%3A%22us%22%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D';
const POPULATED_COMPARE =
  '%5B%22%22%2C%7B%22children%22%3A%5B%22%28layout%29%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%22q%22%3A%22gaming%20laptop%22%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D';
const EMPTY_TREE =
  '%5B%22%22%2C%7B%22children%22%3A%5B%22%28layout%29%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

test.describe('BUY-69260 RSC navigation — populated __PAGE__', () => {
  test('/search with populated __PAGE__ returns 200 (5/5)', async ({ request }) => {
    const results: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await request.get('https://buywhere.ai/search?q=gaming%20laptop&country=us', {
        headers: {
          'User-Agent': CHROME_UA,
          Accept: 'text/x-component',
          'RSC': '1',
          'Next-Router-State-Tree': POPULATED_SEARCH,
        },
      });
      results.push(response.status());
    }
    expect(results).toEqual([200, 200, 200, 200, 200]);
  });

  test('/compare with populated __PAGE__ returns 200 (5/5)', async ({ request }) => {
    const results: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await request.get('https://buywhere.ai/compare?q=gaming%20laptop', {
        headers: {
          'User-Agent': CHROME_UA,
          Accept: 'text/x-component',
          'RSC': '1',
          'Next-Router-State-Tree': POPULATED_COMPARE,
        },
      });
      results.push(response.status());
    }
    expect(results).toEqual([200, 200, 200, 200, 200]);
  });

  test('/search with empty __PAGE__ continues to return 200 (regression)', async ({ request }) => {
    const response = await request.get('https://buywhere.ai/search?q=gaming%20laptop&country=us', {
      headers: {
        'User-Agent': CHROME_UA,
        Accept: 'text/x-component',
        'RSC': '1',
        'Next-Router-State-Tree': EMPTY_TREE,
      },
    });
    expect(response.status()).toBe(200);
  });

  test('/search simple prefetch continues to return 200 (regression)', async ({ request }) => {
    const response = await request.get('https://buywhere.ai/search?q=gaming%20laptop&country=us', {
      headers: {
        'User-Agent': CHROME_UA,
        Accept: 'text/x-component',
        'RSC': '1',
      },
    });
    expect(response.status()).toBe(200);
  });

  test('/search plain HTML continues to return 200 (regression)', async ({ request }) => {
    const response = await request.get('https://buywhere.ai/search?q=gaming%20laptop&country=us', {
      headers: {
        'User-Agent': CHROME_UA,
      },
    });
    expect(response.status()).toBe(200);
  });

  test('/compare plain HTML continues to return 200 (regression)', async ({ request }) => {
    const response = await request.get('https://buywhere.ai/compare?q=gaming%20laptop', {
      headers: {
        'User-Agent': CHROME_UA,
      },
    });
    expect(response.status()).toBe(200);
  });

  test('middleware strips Next-Router-State-Tree for populated __PAGE__ on /search', async ({ request }) => {
    // After middleware rewrite, the request should resolve to 200 even though
    // the original header carried the populated __PAGE__ shape that previously
    // crashed Next 14.2.35's router-state parser.
    const response = await request.get('https://buywhere.ai/search?q=gaming%20laptop&country=us', {
      headers: {
        'User-Agent': CHROME_UA,
        Accept: 'text/x-component',
        'RSC': '1',
        'Next-Router-State-Tree': POPULATED_SEARCH,
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);
  });

  test('home route continues to return 200 (regression: middleware pass-through)', async ({ request }) => {
    // Make sure the middleware strip doesn't affect non-/search non-/compare routes.
    const response = await request.get('https://buywhere.ai/', {
      headers: {
        'User-Agent': CHROME_UA,
      },
    });
    expect(response.status()).toBe(200);
  });
});
