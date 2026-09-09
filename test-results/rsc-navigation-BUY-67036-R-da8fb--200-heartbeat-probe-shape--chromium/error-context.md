# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: rsc-navigation.spec.ts >> BUY-67036 RSC navigation requests >> /compare populated __PAGE__ shape returns 200 (heartbeat probe shape)
- Location: tests/e2e/rsc-navigation.spec.ts:121:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 200
Received: 500
```

# Test source

```ts
  32  |   '%5B%22%22%2C%20%7B%22children%22%3A%20%5B%22%28layout%29%22%2C%20%7B%22children%22%3A%20%5B%22__PAGE__%22%2C%20%7B%7D%2C%20null%2C%20null%2C%20false%5D%7D%2C%20null%2C%20null%2C%20false%5D%7D%2C%20null%2C%20null%2C%20true%5D';
  33  | 
  34  | const CHROME_UA =
  35  |   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
  36  | 
  37  | test.describe('BUY-67036 RSC navigation requests', () => {
  38  |   test('/search full Chrome RSC nav returns 200', async ({ baseURL }) => {
  39  |     const ctx = await request.newContext({
  40  |       baseURL,
  41  |       extraHTTPHeaders: {
  42  |         'User-Agent': CHROME_UA,
  43  |         Accept: 'text/x-component',
  44  |         RSC: '1',
  45  |         'Next-Router-State-Tree': RSC_STATE_TREE,
  46  |       },
  47  |     });
  48  |     const response = await ctx.get('/search?q=gaming%20laptop&country=us');
  49  |     expect(response.status()).toBe(200);
  50  |     await ctx.dispose();
  51  |   });
  52  | 
  53  |   test('/compare full Chrome RSC nav returns 200', async ({ baseURL }) => {
  54  |     const ctx = await request.newContext({
  55  |       baseURL,
  56  |       extraHTTPHeaders: {
  57  |         'User-Agent': CHROME_UA,
  58  |         Accept: 'text/x-component',
  59  |         RSC: '1',
  60  |         'Next-Router-State-Tree': RSC_STATE_TREE,
  61  |       },
  62  |     });
  63  |     const response = await ctx.get('/compare?q=gaming%20laptop');
  64  |     expect(response.status()).toBe(200);
  65  |     await ctx.dispose();
  66  |   });
  67  | 
  68  |   test('/search simple RSC prefetch still returns 200', async ({ baseURL }) => {
  69  |     const ctx = await request.newContext({
  70  |       baseURL,
  71  |       extraHTTPHeaders: {
  72  |         'User-Agent': CHROME_UA,
  73  |         Accept: 'text/x-component',
  74  |         RSC: '1',
  75  |       },
  76  |     });
  77  |     const response = await ctx.get('/search?q=laptop&_rsc=test');
  78  |     expect(response.status()).toBe(200);
  79  |     await ctx.dispose();
  80  |   });
  81  | 
  82  |   test('/compare simple RSC prefetch still returns 200', async ({ baseURL }) => {
  83  |     const ctx = await request.newContext({
  84  |       baseURL,
  85  |       extraHTTPHeaders: {
  86  |         'User-Agent': CHROME_UA,
  87  |         Accept: 'text/x-component',
  88  |         RSC: '1',
  89  |       },
  90  |     });
  91  |     const response = await ctx.get('/compare?q=laptop&_rsc=test');
  92  |     expect(response.status()).toBe(200);
  93  |     await ctx.dispose();
  94  |   });
  95  | 
  96  |   // The two tests below cover the *exact* Next-Router-State-Tree shape
  97  |   // that real Chrome sends during the second-tap navigation in production
  98  |   // — the shape the canonical Reed heartbeat probe used through
  99  |   // 2026-08-13T05:14Z, which produced HTTP 500 on live even when the
  100 |   // simpler `(layout) → __PAGE__: {}` shape above returned 200. This is
  101 |   // the shape BUY-67036 was filed against; without coverage here, the
  102 |   // shape-A tests above pass on the broken code path.
  103 |   const POPULATED_PAGE_TREE =
  104 |     '%5B%22%22%2C%7B%22children%22%3A%5B%22search%22%2C%7B%22children%22%3A%5B%5B%22slug%22%2C%22gaming%2Blaptop%22%2C%22c%22%5D%2C%7B%22q%22%3A%22gaming%20laptop%22%2C%22country%22%3A%22us%22%7D%5D%7D%5D%7D%5D';
  105 | 
  106 |   test('/search populated __PAGE__ shape returns 200 (heartbeat probe shape)', async ({ baseURL }) => {
  107 |     const ctx = await request.newContext({
  108 |       baseURL,
  109 |       extraHTTPHeaders: {
  110 |         'User-Agent': CHROME_UA,
  111 |         Accept: 'text/x-component',
  112 |         RSC: '1',
  113 |         'Next-Router-State-Tree': POPULATED_PAGE_TREE,
  114 |       },
  115 |     });
  116 |     const response = await ctx.get('/search?q=gaming%20laptop&country=us');
  117 |     expect(response.status()).toBe(200);
  118 |     await ctx.dispose();
  119 |   });
  120 | 
  121 |   test('/compare populated __PAGE__ shape returns 200 (heartbeat probe shape)', async ({ baseURL }) => {
  122 |     const ctx = await request.newContext({
  123 |       baseURL,
  124 |       extraHTTPHeaders: {
  125 |         'User-Agent': CHROME_UA,
  126 |         Accept: 'text/x-component',
  127 |         RSC: '1',
  128 |         'Next-Router-State-Tree': POPULATED_PAGE_TREE,
  129 |       },
  130 |     });
  131 |     const response = await ctx.get('/compare?ids=a-b&q=gaming%20laptop');
> 132 |     expect(response.status()).toBe(200);
      |                               ^ Error: expect(received).toBe(expected) // Object.is equality
  133 |     await ctx.dispose();
  134 |   });
  135 | });
```