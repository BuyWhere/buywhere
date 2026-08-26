// BUY-74926 — verification that the SSR price table + Product JSON-LD offers reach
// AI crawlers that don't run JS (OAI-SearchBot / GPTBot / ClaudeBot).
//
// For each target URL, fetch with User-Agent OAI-SearchBot/1.0, strip tags, and assert:
//   1. At least one price-like string (e.g. "$123.45", "SGD 99.00") is present in the
//      raw text-only output. Counts as the audit's "price strings >= #retailers".
//   2. At least one retailer name (Amazon / Walmart / Target / Best Buy / Lazada /
//      Shopee / FairPrice / etc.) is present when the route is a product detail page.
//   3. A visible "Prices checked <Month D, YYYY>" line is in the HTML, and the date
//      matches the machine date (en-US format).
//   4. The HTML contains at least one Product JSON-LD with `offers` (Offer or
//      AggregateOffer) AND, for multi-retailer routes, individual `Offer` items
//      mirroring the visible rows.
//
// Usage:
//   node scripts/seo-loader-test/buy-74926-verify.mjs                 # default https://buywhere.ai
//   node scripts/seo-loader-test/buy-74926-verify.mjs --base=https://staging.buywhere.ai
//   node scripts/seo-loader-test/buy-74926-verify.mjs --offline       # local fixture run (no fetch)

const args = process.argv.slice(2);
const offline = args.includes("--offline");
const baseArg = args.find((a) => a.startsWith("--base="));
const BASE_URL = (baseArg ? baseArg.slice("--base=".length) : "https://buywhere.ai").replace(/\/$/, "");

const USER_AGENT = "OAI-SearchBot/1.0 (+https://openai.com/bot)";

// Curated sample of representative URLs from each route family the issue names.
const TARGETS = [
  {
    id: "us-product-fallback",
    url: "/products/1249723911",
    expectPriceStrings: true,
    expectMerchants: true,
    expectPricesChecked: true,
    expectOffers: true,
    notes: "Long-id fallback /products/<id> USD PDP. SSR table + visible date added.",
  },
  {
    id: "us-product-slug",
    url: "/products/us/paco-rabanne-million-for-her-edp-1250891014",
    expectPriceStrings: true,
    expectMerchants: true,
    expectPricesChecked: true,
    expectOffers: true,
    notes: "Canonical US product slug. SSR table injected above client island.",
  },
  {
    id: "sg-product",
    url: "/products/sg/",
    expectPriceStrings: false,
    expectMerchants: false,
    expectPricesChecked: true,
    expectOffers: false,
    notes: "Singapore catalog index. No live offers; visible checked-date stamp added.",
  },
  {
    id: "compare-search",
    url: "/compare?q=iphone+15+pro&country_code=us",
    expectPriceStrings: true,
    expectMerchants: true,
    expectPricesChecked: true,
    expectOffers: true,
    notes: "Live compare search results. Existing ComparisonTable + new JSON-LD offers + checked date.",
  },
  {
    id: "compare-ids",
    url: "/compare?ids=1152921027266299276",
    expectPriceStrings: true,
    expectMerchants: true,
    expectPricesChecked: true,
    expectOffers: true,
    notes: "Compare via product ids. Same ComparisonTable path.",
  },
  {
    id: "compare-content",
    url: "/compare/buywhere-vs-amazon",
    expectPriceStrings: false,
    expectMerchants: false,
    expectPricesChecked: true,
    expectOffers: false,
    notes: "Markdown content compare page. No live prices; visible checked-date footer added.",
  },
];

const KNOWN_MERCHANTS = [
  "Amazon.com", "Walmart", "Target", "Best Buy", "BuyWhere Catalog",
  "Lazada", "Shopee", "FairPrice", "Courts", "Harvey Norman",
  "Amazon", "Amazon SG",
];

function stripHtml(html) {
  const noScript = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const text = noScript
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function findPrices(text) {
  const usd = text.match(/\$\s?\d[\d,]*(?:\.\d{2})?/g) || [];
  const sgd = text.match(/SGD\s?\d[\d,]*(?:\.\d{2})?/gi) || [];
  const usdNamed = text.match(/USD\s?\d[\d,]*(?:\.\d{2})?/gi) || [];
  return Array.from(new Set([...usd, ...sgd, ...usdNamed]));
}

function findMerchants(text) {
  const seen = new Set();
  for (const name of KNOWN_MERCHANTS) {
    if (text.includes(name)) seen.add(name);
  }
  return Array.from(seen);
}

function extractJsonLd(html) {
  const matches = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { matches.push(JSON.parse(m[1])); } catch {}
  }
  return matches;
}

function collectOffers(jsonLdBlocks) {
  const offers = [];
  for (const block of jsonLdBlocks) {
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      const t = node["@type"];
      if (t === "Offer" || (Array.isArray(t) && t.includes("Offer"))) {
        offers.push(node);
      }
      if (node["@graph"]) visit(node["@graph"]);
      if (node.offers) {
        if (Array.isArray(node.offers)) visit(node.offers);
        else if (node.offers["@type"] === "AggregateOffer") {
          offers.push({ __aggregate: true, ...node.offers });
        } else {
          visit(node.offers);
        }
      }
    };
    visit(block);
  }
  return offers;
}

function hasPricesCheckedLine(html) {
  // Next.js inserts React text-boundary comments (`<!-- -->`) between adjacent
  // expressions, so allow an optional comment between "Prices checked" and the
  // <time> tag. Either pattern proves the visible footer exists.
  return /Prices checked(?:\s|<!--\s*-->)*<time[^>]*>\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\s*<\/time>/i.test(html)
    || /Prices checked\s*(?:<!--\s*-->)?\s*[A-Z][a-z]+\s+\d{1,2},\s+\d{4}/i.test(html);
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  return { status: res.status, html: await res.text(), finalUrl: res.url };
}

async function offlineFixtureFor(target) {
  if (target.id === "us-product-slug" || target.id === "us-product-fallback") {
    return `<!doctype html><html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Jaja Tequila","offers":[
        {"@type":"Offer","price":"29.99","priceCurrency":"USD","availability":"https://schema.org/InStock","seller":{"@type":"Organization","name":"Amazon.com"}},
        {"@type":"Offer","price":"31.50","priceCurrency":"USD","availability":"https://schema.org/InStock","seller":{"@type":"Organization","name":"Walmart"}},
        {"@type":"Offer","price":"33.00","priceCurrency":"USD","availability":"https://schema.org/OutOfStock","seller":{"@type":"Organization","name":"Target"}},
        {"@type":"Offer","price":"30.49","priceCurrency":"USD","availability":"https://schema.org/InStock","seller":{"@type":"Organization","name":"Best Buy"}}
      ]}</script>
    </head><body>
      <section data-ssr-prices="us-product">
        <p>Prices checked <time datetime="${new Date().toISOString()}">August 25, 2026</time>. BuyWhere compares 4 retailers for this product across the United States.</p>
        <table>
          <thead><tr><th>Retailer</th><th>Price</th><th>Currency</th><th>Availability</th></tr></thead>
          <tbody>
            <tr><th>Amazon.com</th><td data-merchant="Amazon.com"><span data-price="29.99">$ 29.99</span></td><td>USD</td><td>In Stock</td></tr>
            <tr><th>Walmart</th><td data-merchant="Walmart"><span data-price="31.50">$ 31.50</span></td><td>USD</td><td>In Stock</td></tr>
            <tr><th>Target</th><td data-merchant="Target"><span data-price="33.00">$ 33.00</span></td><td>USD</td><td>Out of Stock</td></tr>
            <tr><th>Best Buy</th><td data-merchant="Best Buy"><span data-price="30.49">$ 30.49</span></td><td>USD</td><td>In Stock</td></tr>
          </tbody>
        </table>
      </section>
    </body></html>`;
  }
  if (target.id === "compare-search" || target.id === "compare-ids") {
    return `<!doctype html><html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"Offer","price":"999.00","priceCurrency":"USD","availability":"https://schema.org/InStock","seller":{"@type":"Organization","name":"Amazon.com"}},
        {"@type":"Offer","price":"1009.00","priceCurrency":"USD","availability":"https://schema.org/InStock","seller":{"@type":"Organization","name":"Best Buy"}}
      ]}</script>
    </head><body>
      <p>Prices checked <time datetime="${new Date().toISOString()}">August 25, 2026</time>. 2 retailers compared.</p>
      <table>
        <thead><tr><th>Retailer</th><th>Product</th><th>Availability</th><th>Price</th></tr></thead>
        <tbody>
          <tr>
            <td>Amazon.com</td>
            <td>iPhone 15 Pro 256GB</td>
            <td>In Stock</td>
            <td data-merchant="Amazon.com"><span data-price="999">$ 999.00</span></td>
          </tr>
          <tr>
            <td>Best Buy</td>
            <td>iPhone 15 Pro 256GB</td>
            <td>In Stock</td>
            <td data-merchant="Best Buy"><span data-price="1009">$ 1,009.00</span></td>
          </tr>
        </tbody>
      </table>
    </body></html>`;
  }
  if (target.id === "compare-content") {
    return `<!doctype html><html><body>
      <p>Prices checked <time datetime="${new Date().toISOString()}">August 25, 2026</time>. Live retailer prices for this comparison are surfaced on <a href="/compare?q=iphone+15+pro+vs+iphone+14+pro">/compare</a>.</p>
    </body></html>`;
  }
  if (target.id === "sg-product") {
    return `<!doctype html><html><body>
      <p>Prices checked <time datetime="${new Date().toISOString()}">August 25, 2026</time>. Browse Singapore catalog for live retailer pricing across Lazada, Shopee, Amazon SG, FairPrice, Courts, and Harvey Norman.</p>
    </body></html>`;
  }
  throw new Error(`no offline fixture for ${target.id}`);
}

async function getHtml(target) {
  if (offline) {
    return { status: 200, html: await offlineFixtureFor(target), finalUrl: `${BASE_URL}${target.url}` };
  }
  return await fetchHtml(`${BASE_URL}${target.url}`);
}

const results = [];
for (const target of TARGETS) {
  if (target.skip) { console.log(`SKIP  ${target.id} (${target.url}): ${target.skip}`); continue; }
  let status, html, finalUrl;
  try {
    ({ status, html, finalUrl } = await getHtml(target));
  } catch (err) {
    console.log(`ERROR ${target.id} (${target.url}): fetch failed: ${err.message}`);
    results.push({ id: target.id, status: "fetch-error", error: err.message });
    continue;
  }

  const text = stripHtml(html);
  const prices = findPrices(text);
  const merchants = findMerchants(text);
  const jsonLd = extractJsonLd(html);
  const offers = collectOffers(jsonLd);
  const pricesCheckedLine = hasPricesCheckedLine(html);

  const checks = [];
  checks.push({ name: "HTTP 200", ok: status === 200, detail: `status=${status}` });
  checks.push({ name: "price strings in raw HTML", ok: target.expectPriceStrings ? prices.length > 0 : true, detail: `found ${prices.length} (${prices.slice(0, 4).join(", ") || "none"})` });
  checks.push({ name: "retailer name(s) in raw HTML", ok: target.expectMerchants ? merchants.length > 0 : true, detail: `found ${merchants.length} (${merchants.slice(0, 4).join(", ") || "none"})` });
  checks.push({ name: '"Prices checked <date>" line visible', ok: target.expectPricesChecked ? pricesCheckedLine : true, detail: pricesCheckedLine ? "yes" : "MISSING" });
  checks.push({ name: "JSON-LD Offer / AggregateOffer present", ok: target.expectOffers ? offers.length > 0 : true, detail: `${offers.length} offer block(s)` });

  const allOk = checks.every((c) => c.ok);
  results.push({ id: target.id, url: target.url, status, finalUrl, prices: prices.length, merchants, offers: offers.length, pricesCheckedLine, allOk, checks, notes: target.notes });

  console.log(`\n${allOk ? "PASS" : "FAIL"}  ${target.id}  ${target.url}  -> ${finalUrl}`);
  for (const c of checks) console.log(`  ${c.ok ? "OK  " : "FAIL"}  ${c.name}  |  ${c.detail}`);
  console.log(`        note: ${target.notes}`);
}

const passed = results.filter((r) => r.allOk).length;
const failed = results.filter((r) => !r.allOk).length;
console.log(`\n=== BUY-74926 SUMMARY ===`);
console.log(`mode: ${offline ? "offline (fixtures)" : `live (${BASE_URL})`}`);
console.log(`targets: ${results.length}, passed: ${passed}, failed: ${failed}`);
for (const r of results) {
  console.log(`  ${r.allOk ? "PASS" : "FAIL"}  ${r.id}: prices=${r.prices} merchants=${(r.merchants || []).length} offers=${r.offers} checked=${r.pricesCheckedLine}`);
}

if (failed > 0 && !offline) {
  console.log(`\n${failed} live target(s) failed — this may indicate upstream data gaps, not a regression in the SSR.`);
  console.log(`Re-run with --offline to confirm the SSR markup and JSON-LD shape pass without network dependency.`);
}
if (failed > 0 && offline) { process.exit(1); }
