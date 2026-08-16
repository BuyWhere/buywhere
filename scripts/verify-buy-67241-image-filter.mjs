// Standalone smoke test for BUY-67241 image-host filter.
// Mirrors the SearchResultsClient.tsx hasUsableProductImage logic, post-fix.
// Run: node scripts/verify-buy-67241-image-filter.mjs

const SEARCH_IMAGE_BLOCKED_HOSTS = new Set([
  'example.sg', 'example.com', 'example.net', 'example.org',
  'source.unsplash.com', 'images.unsplash.com',
  'c1.neweggimages.com',
  'www.neweggimages.com',
  'www.harveynorman.com.sg',
  'harveynorman.com.sg',
  'contents.mediadecathlon.com',
  'www.mediadecathlon.com',
  'cdn.shopify.com',
  'shopify.com',
  'www.shopify.com',
]);

function hasUsableProductImage(value) {
  if (!value) return false;
  try {
    const imageUrl = new URL(value);
    const hostname = imageUrl.hostname.toLowerCase();
    const pathname = imageUrl.pathname.toLowerCase();
    const search = imageUrl.search.toLowerCase();
    const fullUrl = `${hostname}${pathname}${search}`;
    if (SEARCH_IMAGE_BLOCKED_HOSTS.has(hostname)) return false;
    if (hostname.includes('source.unsplash.com') || fullUrl.includes('source.unsplash.com')) return false;
    if (hostname.includes('images.unsplash.com') || fullUrl.includes('images.unsplash.com')) return false;
    if (hostname.includes('unsplash.com')) return false;
    if (hostname === 'm.media-amazon.com' && /\/images\/i\/b\d{10,}\._/.test(pathname)) return false;
    if (hostname === 'example.sg' || hostname.endsWith('.example.sg')) return false;
    if (hostname === 'example.com' || hostname.endsWith('.example.com')) return false;
    if (hostname === 'example.net' || hostname.endsWith('.example.net')) return false;
    if (hostname === 'example.org' || hostname.endsWith('.example.org')) return false;
    if (fullUrl.includes('placeholder')) return false;
    if (fullUrl.includes('image-unavailable')) return false;
    if (fullUrl.includes('no-image')) return false;
    if (fullUrl.includes('no_image')) return false;
    if (fullUrl.includes('missing-image')) return false;
    if (fullUrl.includes('generic')) return false;
    if (hostname.endsWith('.mediadecathlon.com')) return false;
    if (hostname.endsWith('.shopify.com')) return false;
    if (hostname.endsWith('.shopifycdn.com')) return false;
    return true;
  } catch {
    return false;
  }
}

const cases = [
  // BUY-67241 hard-410 hosts
  ['https://contents.mediadecathlon.com/picture-product-3/sony-wireless-headphones-1234.jpg', false],
  ['https://www.mediadecathlon.com/path/img.png', false],
  ['https://cdn.mediadecathlon.com/path/img.png', false],
  ['https://static.mediadecathlon.com/path/img.png', false],
  // BUY-67241 mixed-410 hosts
  ['https://cdn.shopify.com/s/files/1/0240/9337/files/1_JBudsOpen_Cloud.jpg?v=1773247734', false],
  ['https://shopify.com/path/img.png', false],
  ['https://www.shopify.com/path/img.png', false],
  ['https://burst.shopifycdn.com/path/img.png', false],
  ['https://cdn.shopify.com/s/files/1/abc/def.jpg', false],
  // Sanity: ordinary hosts
  ['https://m.media-amazon.com/images/I/71abc.jpg', true],
  ['https://c2.neweggimages.com/neweggimg/2018/abc.jpg', true],
  ['https://dlcdnwebimgs.asus.com/gain/abc.jpg', true],
  // Regression: existing unsplash / placeholder / example
  ['https://source.unsplash.com/abc/200x200', false],
  ['https://images.unsplash.com/abc.jpg', false],
  ['https://example.sg/products/abc.jpg', false],
  ['https://cdn.example.com/img.jpg', false],
];

let pass = 0, fail = 0;
for (const [url, expected] of cases) {
  const got = hasUsableProductImage(url);
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'}  expected=${expected} got=${got}  ${url}`);
}
console.log(`\n${pass}/${pass+fail} passed`);
process.exit(fail === 0 ? 0 : 1);
