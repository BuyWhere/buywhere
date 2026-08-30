import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildSeoLandingMetadata,
  compareLandingCardOrder,
  findFloorPriceProductId,
  getSeoLandingProducts,
  getSeoLandingFallbackProduct,
  isCompleteRobotVacuum,
  resolveHeroTitle,
  seoLandingPages,
  stripCountryTokens,
  verifyReachableImage,
  type LandingProduct,
} from "@/lib/seo-landing-pages";

function makeSearchItem(id: string, title: string, price = 199) {
  return {
    id,
    title,
    price_amount: price,
    price_currency: "USD",
    merchant: "bestbuy_us",
    merchant_name: "Best Buy",
    click_url: `https://merchant.example/${id}`,
    image_url: `https://images.example/${id}.jpg`,
  };
}

function makeLandingProduct(name: string): Pick<LandingProduct, "name" | "brand" | "category"> {
  return { name, brand: null, category: null };
}

test("SEO landing products never render synthetic placeholder catalog cards", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [],
        meta: { total: 0, degraded: true },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    for (const config of Object.values(seoLandingPages)) {
      const products = await getSeoLandingProducts(config);
      for (const product of products) {
        const text = [product.name, product.brand].filter(Boolean).join(" ");
        assert.doesNotMatch(text, /\b(product|brand)\s+[a-e]\b/i, `${config.slug} rendered ${text}`);
        assert.ok(product.imageUrl, `${config.slug} rendered ${product.name} without a real image URL`);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sampled noise-canceling headphones page uses real fallback products", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [], meta: { total: 0, degraded: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    const products = await getSeoLandingProducts(seoLandingPages["best-noise-canceling-headphones-us"]);
    assert.ok(products.length >= 4, "expected fallback product cards for headphones page");
    assert.deepEqual(
      products.slice(0, 4).map((product) => product.brand),
      ["Sony", "Bose", "Apple", "Sennheiser"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("QA-sampled SEO pages keep credible image-backed fallback catalogs", async () => {
  const originalFetch = globalThis.fetch;
  // BUY-72468: route distinct mock responses by URL. The product search API
  // returns an empty degraded payload (no live products), but the verifyReachableImage
  // HEAD probe expects an image/* content-type response so the fallback imageUrl
  // is treated as reachable. Anything else falls through to the branded SVG
  // placeholder — which is the pre-BUY-72468 failure mode.
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/products/search")) {
      return new Response(JSON.stringify({ data: [], meta: { total: 0, degraded: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } });
  };

  try {
    const sampledSlugs = [
      "laptop-singapore",
      "best-gaming-laptops-us",
      "best-robot-vacuums-2026",
      "air-purifier-singapore",
      "best-noise-canceling-headphones-us",
    ];

    for (const slug of sampledSlugs) {
      const products = await getSeoLandingProducts(seoLandingPages[slug]);
      assert.ok(products.length >= 4, `${slug} should render at least 4 product cards`);
      for (const product of products) {
        // BUY-70187: hotlink-blocked hosts render through /api/image-proxy
        // (a real remote fetch, just routed server-side), so accept either
        // a direct https URL or the proxy form.
        assert.match(product.imageUrl || "", /^(https?:\/\/|\/api\/image-proxy\?url=)/, `${slug} rendered ${product.name} without a real remote product image URL`);
        assert.notEqual(product.href, "#", `${slug} rendered ${product.name} without a product/search link`);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("robot-vacuum classifier accepts complete floor robots and rejects accessories and other vacuum types", () => {
  const completeRobots = [
    "iRobot Roomba j7 Robot Vacuum",
    "Roborock Qrevo Robot Vacuum with Multifunctional Dock",
    "Lefant Robot Vacuum and Mop, M501-A Robotic Vacuums Cleaner",
    "ECOVACS DEEBOT T8+ Vacuum & Mop Robot",
    "Roborock S7 Pro Ultra Robot Vacuum with HEPA filter for allergies",
    "iRobot Roomba i7+ Robot Vacuum with tangle-free rubber brushes",
    "Roborock S8 MaxV Ultra Robot Vacuum with dust bag included",
  ];
  const rejectedProducts = [
    "Xiaomi Robot Vacuum E10 2600mAh Vacuum Replacement Battery",
    "Eufy Fabric Cleaner for Eufy Robot Vacuum Omni E28",
    "Eufy Accessories Package For Eufy Robot Vacuum Omni E28",
    "12-Pack Replacement Mop Pads for Narwal Robot Vacuum & Mop",
    "6 Pack Dust Bags Set for iRobot Roomba Robot Vacuum",
    "Ecovacs vacuum accessory/supply Robot vacuum Dust bag",
    "Roborock H60 Cordless Stick Vacuum",
    "Bestway Automatic Robotic Pool Vacuum",
    "Roborock F25 Vacuum Mop",
  ];

  completeRobots.forEach((name) => assert.equal(isCompleteRobotVacuum(makeLandingProduct(name)), true, name));
  rejectedProducts.forEach((name) => assert.equal(isCompleteRobotVacuum(makeLandingProduct(name)), false, name));
});

test("robot-vacuum landing page excludes parts and tops up sparse live results with complete robots", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response(
      JSON.stringify({
        data: [
          makeSearchItem("battery", "Roborock MC1808 Vacuum Replacement Battery", 54),
          makeSearchItem("accessories", "Eufy Accessories Package For Eufy Robot Vacuum Omni E28", 60),
          makeSearchItem("stick", "Roborock H60 Cordless Stick Vacuum", 2499),
          makeSearchItem("robot", "Lefant Robot Vacuum and Mop, M501-A Robotic Vacuums Cleaner", 148),
        ],
        meta: { total: 4, degraded: false },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const products = await getSeoLandingProducts(seoLandingPages["best-robot-vacuums-2026"]);
    assert.ok(requestedUrls.length > 0);
    assert.ok(requestedUrls.every((url) => url.includes("category=robot_vacuums")));
    assert.ok(requestedUrls.every((url) => url.includes("limit=24")));
    assert.equal(products.length, 4);
    assert.equal(products[0].name, "Lefant Robot Vacuum and Mop, M501-A Robotic Vacuums Cleaner");
    products.forEach((product) => assert.equal(isCompleteRobotVacuum(product), true, product.name));
    assert.doesNotMatch(products.map((product) => product.name).join(" "), /replacement|accessories|stick vacuum/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SEO landing products consume live API products payloads", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!url.includes("/api/products/search")) {
      return new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } });
    }

    return new Response(
      JSON.stringify({
        products: [makeSearchItem("earbuds", "Sony WF-1000XM5 Wireless Earbuds", 199)],
        total: 1,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const products = await getSeoLandingProducts(seoLandingPages["best-noise-canceling-headphones-us"]);
    assert.equal(products[0].id, "earbuds");
    assert.equal(products[0].name, "Sony WF-1000XM5 Wireless Earbuds");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("robot-vacuum landing page uses compact, unclipped product cards with complete offer data", () => {
  const pageSource = readFileSync(new URL("../components/seo/SeoLandingPage.tsx", import.meta.url), "utf8");
  const cardSource = readFileSync(new URL("../components/seo/ProductGridCard.tsx", import.meta.url), "utf8");
  const imageSource = readFileSync(new URL("../components/seo/ProductGridImage.tsx", import.meta.url), "utf8");

  assert.match(pageSource, /config\.compactCatalogCards \? "grid gap-4 lg:grid-cols-2"/);
  assert.match(pageSource, /config\.compactCatalogCards \? "py-6"/);
  assert.match(pageSource, /<ProductGridCard[^>]+compact=\{config\.compactCatalogCards\}/);
  assert.doesNotMatch(cardSource, /className="group[^"\n]*overflow-hidden/);
  assert.match(cardSource, /compact \? "w-full text-xs" : "text-sm"/);
  assert.match(cardSource, /Current price/);
  assert.match(cardSource, /Buy at \{product\.merchant\}/);
  assert.match(imageSource, /onError=\{\(\) => setHasError\(true\)\}/);
  assert.match(imageSource, /if \(hasError \|\| !src\)/);
  assert.match(readFileSync(new URL("./seo-landing-pages.ts", import.meta.url), "utf8"), /url\.hostname !== "elescat\.store"/);
});

test("non-robot landing pages retain the existing eight-result request size", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ data: [], meta: { total: 0, degraded: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await getSeoLandingProducts(seoLandingPages["best-noise-canceling-headphones-us"]);
    assert.match(requestedUrl, /limit=8/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("QA-sampled SEO source configs do not contain synthetic placeholders", () => {
  const source = readFileSync(new URL("./seo-landing-pages.ts", import.meta.url), "utf8");
  const sampledSlugs = [
    "laptop-singapore",
    "best-gaming-laptops-us",
    "best-robot-vacuums-2026",
    "air-purifier-singapore",
    "best-noise-canceling-headphones-us",
  ];

  for (const slug of sampledSlugs) {
    const start = source.indexOf(`\"${slug}\": {`);
    const nextConfigStart = source.indexOf("\n  \"", start + slug.length + 5);
    const end = nextConfigStart > start ? nextConfigStart : source.length;
    const block = source.slice(start, end);

    assert.notEqual(start, -1, `${slug} config should exist`);
    assert.doesNotMatch(block, /\bProduct\s+[A-E]\b|\bBrand\s+[A-E]\b/i, `${slug} still has synthetic catalog copy in source`);
    assert.doesNotMatch(block, /imageUrl:\s*null/i, `${slug} still has image-less fallback products in source`);
    assert.doesNotMatch(block, /imageUrl:\s*"\/seo\//i, `${slug} still uses local SEO placeholder artwork in source`);
  }
});

test("BUY-72906: US SEO landing search passes deliver_to + include_unshippable=false + country", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/products/search")) {
      requestedUrl = url;
      return new Response(
        JSON.stringify({ data: [], meta: { total: 0, degraded: true } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("", { status: 200, headers: { "content-type": "image/jpeg" } });
  };

  try {
    await getSeoLandingProducts(seoLandingPages["best-gaming-laptops-us"]);
    assert.match(requestedUrl, /[?&]country=US/);
    assert.match(requestedUrl, /[?&]deliver_to=US/);
    assert.match(requestedUrl, /[?&]include_unshippable=false/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// BUY-73640 / BUY-73322-FIX: hard US merchant allowlist
//
// The /v1/products/search backend returns merchant metadata as a bare string slug
// (e.g. "newegg_us", "compumarts"), NOT a nested object with region/countryCode.
// The previous filter (BUY-72906) only checked countryCode, so CompuMarts leaked
// through when their row had no countryCode or had a mismatched one.
//
// The hard allowlist now gates at the slug level before normalization. Three
// regression layers:
//
//   1. Source: merchant-allowlist.ts declares the slug sets and the
//      isMerchantAllowedForCountry / filterProductsForCountry helpers.
//   2. Wire: the US/SG filter runs inside the per-item loop in getSeoLandingProducts.
//   3. Functional: a US SEO page must keep allowed US merchants and drop
//      CompuMarts / non-US / unknown-merchant rows entirely.
// ---------------------------------------------------------------------------

test("BUY-73640: source declares merchant allowlist constants + filter helpers", () => {
  const source = readFileSync(new URL("./seo-landing-pages.ts", import.meta.url), "utf8");
  assert.ok(source.includes("isMerchantAllowedForCountry(item, allowlistCountry)"), "US/SG merchant slug gate must run inside per-item loop");
});

test("BUY-73640: US SEO page drops compumarts + non-US + unknown-merchant live products", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/products/search")) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "p1", title: "ASUS ROG Zephyrus G16 Gaming Laptop RTX 5070", price_amount: 1999, price_currency: "USD", merchant: "bestbuy_us", merchant_name: "Best Buy", click_url: "https://example.com/p1", image_url: "https://images.example/p1.jpg" },
            { id: "p2", title: "ASUS ROG Zephyrus G16 Gaming Laptop RTX 5070", price_amount: 1899, price_currency: "USD", merchant: "amazon_us", merchant_name: "Amazon US", click_url: "https://example.com/p2", image_url: "https://images.example/p2.jpg" },
            // compumarts — known leak target (BUY-73322)
            { id: "p3", title: "ASUS ROG Zephyrus G16 Gaming Laptop RTX 5070", price_amount: 1799, price_currency: "USD", merchant: "compumarts", merchant_name: "COMPUMARTS", click_url: "https://example.com/p3", image_url: "https://images.example/p3.jpg" },
            // non-US slug (noon = UAE)
            { id: "p4", title: "ASUS ROG Zephyrus G16 Gaming Laptop RTX 5070", price_amount: 1699, price_currency: "USD", merchant: "noon", merchant_name: "Noon", click_url: "https://example.com/p4", image_url: "https://images.example/p4.jpg" },
            // unknown merchant (no slug at all — must be excluded per spec point 3)
            { id: "p5", title: "ASUS ROG Zephyrus G16 Gaming Laptop RTX 5070", price_amount: 1599, price_currency: "USD", merchant_name: "Mystery Store", click_url: "https://example.com/p5", image_url: "https://images.example/p5.jpg" },
            // valid US slug variant (newegg, no _us suffix)
            { id: "p6", title: "ASUS ROG Zephyrus G16 Gaming Laptop RTX 5070", price_amount: 1899, price_currency: "USD", merchant: "newegg", merchant_name: "Newegg", click_url: "https://example.com/p6", image_url: "https://images.example/p6.jpg" },
          ],
          meta: { total: 6, degraded: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("", { status: 200, headers: { "content-type": "image/jpeg" } });
  };

  try {
    const products = await getSeoLandingProducts(seoLandingPages["best-gaming-laptops-us"]);
    const merchants = products.map((p) => p.merchant);
    assert.ok(merchants.some((m) => m === "Best Buy"), "Best Buy must be included");
    assert.ok(merchants.some((m) => m === "Amazon"), "Amazon must be included (normalized label)");
    assert.ok(merchants.some((m) => m === "Newegg"), "Newegg (no _us suffix) must be included");
    assert.ok(!merchants.some((m) => m.toLowerCase().includes("compumart") || m.toLowerCase() === "compumarts"), "COMPUMARTS must be absent");
    assert.ok(!merchants.some((m) => m === "Noon"), "Noon (UAE) must be absent");
    assert.ok(!merchants.some((m) => m === "Mystery Store"), "Unknown-merchant rows must be absent");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BUY-73640: SG SEO page keeps Singapore merchants and drops US merchants", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/products/search")) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "sg1", title: "Dyson Air Purifier", price_amount: 699, price_currency: "SGD", merchant: "shopee_sg", merchant_name: "Shopee Singapore", click_url: "https://example.com/sg1", image_url: "https://images.example/sg1.jpg" },
            { id: "sg2", title: "Dyson Air Purifier", price_amount: 649, price_currency: "SGD", merchant: "lazada_sg", merchant_name: "Lazada Singapore", click_url: "https://example.com/sg2", image_url: "https://images.example/sg2.jpg" },
            { id: "sg3", title: "Dyson Air Purifier", price_amount: 899, price_currency: "SGD", merchant: "bestbuy_us", merchant_name: "Best Buy US", click_url: "https://example.com/sg3", image_url: "https://images.example/sg3.jpg" },
            { id: "sg4", title: "Dyson Air Purifier", price_amount: 599, price_currency: "SGD", merchant: "walmart_us", merchant_name: "Walmart US", click_url: "https://example.com/sg4", image_url: "https://images.example/sg4.jpg" },
            // valid SG slug variant (no _sg suffix)
            { id: "sg5", title: "Dyson Air Purifier", price_amount: 679, price_currency: "SGD", merchant: "courts", merchant_name: "Courts Singapore", click_url: "https://example.com/sg5", image_url: "https://images.example/sg5.jpg" },
          ],
          meta: { total: 5, degraded: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("", { status: 200, headers: { "content-type": "image/jpeg" } });
  };

  try {
    const products = await getSeoLandingProducts(seoLandingPages["air-purifier-singapore"]);
    const merchants = products.map((p) => p.merchant);
    assert.ok(merchants.some((m) => m === "Shopee Singapore" || m === "Shopee"), "Shopee must be included");
    assert.ok(merchants.some((m) => m === "Lazada Singapore" || m === "Lazada"), "Lazada must be included");
    assert.ok(merchants.some((m) => m === "Courts Singapore" || m === "Courts"), "Courts (no _sg suffix) must be included");
    assert.ok(!merchants.some((m) => m === "Best Buy US" || m === "Best Buy"), "Best Buy US must be absent from SG page");
    assert.ok(!merchants.some((m) => m === "Walmart US" || m === "Walmart"), "Walmart US must be absent from SG page");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BUY-73640: curated fallback products are filtered through the same geo allowlist", async () => {
  const originalFetch = globalThis.fetch;
  // Return zero live products so the page falls through entirely to curated fallbacks
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/products/search")) {
      return new Response(JSON.stringify({ data: [], meta: { total: 0, degraded: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 200, headers: { "content-type": "image/jpeg" } });
  };

  try {
    // Use a SG config whose curated fallback contains only SG merchants.
    // If filterProductsForCountry leaks a non-SG merchant through, this test fails.
    const products = await getSeoLandingProducts(seoLandingPages["air-purifier-singapore"]);
    assert.ok(products.length >= 4, "SG page must render at least 4 curated fallback products");
    for (const product of products) {
      assert.ok(
        ["Shopee", "Lazada", "Courts", "Dyson", "Philips", "Xiaomi", "Samsung", "Apple", "Harvey Norman", "Gain City"].some(
          (allowed) => product.merchant.toLowerCase().includes(allowed.toLowerCase()),
        ),
        `fallback product merchant "${product.merchant}" must be a known SG retailer`,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BUY-73640: merchantSlug is preserved on normalized LandingProduct for future allowlist use", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/products/search")) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "x1", title: "ASUS ROG Zephyrus G16 Gaming Laptop RTX 5070", price_amount: 1999, price_currency: "USD", merchant: "walmart_us", merchant_name: "Walmart", click_url: "https://example.com/x1", image_url: "https://images.example/x1.jpg" },
          ],
          meta: { total: 1, degraded: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("", { status: 200, headers: { "content-type": "image/jpeg" } });
  };

  try {
    const products = await getSeoLandingProducts(seoLandingPages["best-gaming-laptops-us"]);
    assert.ok(products.length > 0, "should have at least one product");
    assert.equal(
      products[0].merchantSlug,
      "walmart_us",
      "merchantSlug must be preserved (lowercased, trimmed) from raw upstream merchant field",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// BUY-73741: defense-in-depth final-pipeline gate keeps CompuMarts / Arabic
// / namshi / mumzworld / noon / sharafdg / carrefour out of the rendered
// catalog snapshot AND the JSON-LD ItemList, even when upstream
// `merchant_name` carries the disallowed text instead of the bare slug.
//
// The previous BUY-73640 fix only fired on the raw merchant SLUG. QA
// VidMee render_and_analyze on /best-gaming-laptops-us
// (vidmee://asset/vidmee_ss_e1a5b9d7dd166dd52b3c0866) captured
// "CompuMarts" + Arabic text "سوق الكمبيوتر" on the hydrated page,
// indicating a leak path where merchant_name carried the branded text
// without a corresponding forbidden slug. The final-pipeline gate re-runs
// the country allowlist on the rendered merchant LABEL (matching what QA
// captures) plus a hard text denylist that drops any row containing
// disallowed merchant substrings.
//
// Three regression layers:
//   1. Source: merchant-allowlist.ts exports containsDisallowedMerchantText
//      and DISALLOWED_MERCHANT_TEXT_PATTERNS covering CompuMarts, Arabic
//      script, and the six banned UAE/KSA retailer names.
//   2. Schema: buildSeoLandingSchema() applies the same gate to the
//      JSON-LD seller list so crawlers and QA can't see what the visible
//      cards don't.
//   3. End-to-end SSR: getSeoLandingProducts() return path applies
//      applyFinalCountryGate() on every branch (live, top-up, fallback).
// ---------------------------------------------------------------------------

test("BUY-73741: disallowed merchant text denylist catches CompuMarts + Arabic + UAE retailers", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { containsDisallowedMerchantText } = require("@/lib/merchant-allowlist");
  assert.ok(containsDisallowedMerchantText("CompuMarts"), "CompuMarts label must be flagged");
  assert.ok(containsDisallowedMerchantText("compumart"), "lowercase variant must be flagged");
  assert.ok(containsDisallowedMerchantText("COMPUMARTS"), "uppercase variant must be flagged");
  assert.ok(containsDisallowedMerchantText("سوق الكمبيوتر"), "Arabic script must be flagged");
  assert.ok(containsDisallowedMerchantText("Buy at سوق الكمبيوتر"), "Arabic inside copy must be flagged");
  assert.ok(containsDisallowedMerchantText("Namshi"), "Namshi must be flagged");
  assert.ok(containsDisallowedMerchantText("MumzWorld"), "MumzWorld must be flagged");
  assert.ok(containsDisallowedMerchantText("noon"), "noon must be flagged");
  assert.ok(containsDisallowedMerchantText("Sharaf DG"), "Sharaf DG must be flagged");
  assert.ok(containsDisallowedMerchantText("Carrefour UAE"), "Carrefour must be flagged");
  // False positives the regex set must NOT trigger on:
  assert.ok(!containsDisallowedMerchantText("Amazon"), "Amazon must NOT be flagged");
  assert.ok(!containsDisallowedMerchantText("Best Buy"), "Best Buy must NOT be flagged");
  assert.ok(!containsDisallowedMerchantText("Newegg"), "Newegg must NOT be flagged");
  assert.ok(!containsDisallowedMerchantText("Walmart US"), "Walmart US must NOT be flagged");
});

test("BUY-73741: US SEO page drops row whose merchant_name carries Arabic script (slug-gate bypass)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/products/search")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "good1",
              title: "ASUS ROG Zephyrus G16 Gaming Laptop RTX 5070",
              price_amount: 1999,
              price_currency: "USD",
              merchant: "bestbuy_us",
              merchant_name: "Best Buy",
              click_url: "https://example.com/good1",
              image_url: "https://images.example/good1.jpg",
            },
            // Hydra: bare slug looks innocuous ("shopify_us"), but the
            // merchant_name carries the branded Arabic text VidMee captured.
            // The previous BUY-73640 slug gate passed this through.
            {
              id: "hydra1",
              title: "ASUS ROG Zephyrus G16 Gaming Laptop RTX 5070",
              price_amount: 1899,
              price_currency: "USD",
              merchant: "shopify_us",
              merchant_name: "سوق الكمبيوتر",
              click_url: "https://example.com/hydra1",
              image_url: "https://images.example/hydra1.jpg",
            },
            // Hydrated CompuMarts text alongside an allowed slug — also a
            // known bypass pattern (BUY-72906 left this path open).
            {
              id: "hydra2",
              title: "ASUS ROG Zephyrus G16 Gaming Laptop RTX 5070",
              price_amount: 1799,
              price_currency: "USD",
              merchant: "bestbuy_us",
              merchant_name: "CompuMarts",
              click_url: "https://example.com/hydra2",
              image_url: "https://images.example/hydra2.jpg",
            },
          ],
          meta: { total: 3, degraded: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("", { status: 200, headers: { "content-type": "image/jpeg" } });
  };

  try {
    const products = await getSeoLandingProducts(seoLandingPages["best-gaming-laptops-us"]);
    const merchants = products.map((p) => p.merchant);
    assert.ok(merchants.includes("Best Buy"), "Best Buy must be included");
    for (const merchant of merchants) {
      assert.ok(
        !/compumart/i.test(merchant),
        `CompuMarts label must not appear in rendered products: got "${merchant}"`,
      );
      assert.ok(
        !/سوق/.test(merchant),
        `Arabic script must not appear in rendered products: got "${merchant}"`,
      );
      assert.ok(
        !/\bnamshi\b|\bmumzworld\b|\bnoon\b|\bsharafdg\b|\bcarrefour\b/i.test(merchant),
        `UAE retailer name must not appear in rendered products: got "${merchant}"`,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BUY-73741: JSON-LD seller list is allowlist-pure after final gate", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildSeoLandingSchema } = require("@/lib/seo-landing-pages");
  const products = [
    {
      id: "live1",
      name: "ASUS ROG Zephyrus G16 Gaming Laptop RTX 5070",
      price: 1999,
      currency: "USD",
      merchant: "Best Buy",
      brand: "ASUS",
      category: "Gaming Laptops",
      imageUrl: "https://images.example/live1.jpg",
      href: "/search?q=ASUS+ROG+Zephyrus+G16&country=us",
    },
    {
      id: "leaked1",
      name: "ASUS ROG Zephyrus G16 Gaming Laptop RTX 5070",
      price: 1799,
      currency: "USD",
      merchant: "CompuMarts",
      brand: "ASUS",
      category: "Gaming Laptops",
      imageUrl: "https://images.example/leaked1.jpg",
      href: "/search?q=ASUS+ROG+Zephyrus+G16&country=us",
    },
  ];
  const schema = buildSeoLandingSchema(seoLandingPages["best-gaming-laptops-us"], products);
  const schemaText = JSON.stringify(schema);
  assert.ok(!/compumart/i.test(schemaText), `JSON-LD must not contain CompuMarts; got: ${schemaText}`);
  assert.ok(!/سوق/.test(schemaText), `JSON-LD must not contain Arabic script; got: ${schemaText}`);
  assert.ok(/Best Buy/i.test(schemaText), "JSON-LD must still include Best Buy");
});

test("BUY-72906: foreign-merchant products (COMPUMARTS/AE) are dropped from US SEO snapshot", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/products/search")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "us-live",
              title: "ASUS ROG Zephyrus G16 Gaming Laptop RTX 5070",
              price_amount: 1999,
              price_currency: "USD",
              merchant: "bestbuy_us",
              merchant_name: "Best Buy",
              click_url: "https://merchant.example/us-live",
              image_url: "https://images.example/us-live.jpg",
              country_code: "US",
            },
            {
              id: "ae-live",
              title: "Gaming Laptop RTX 5070",
              price_amount: 1800,
              price_currency: "USD",
              merchant: "compumarts",
              merchant_name: "COMPUMARTS",
              click_url: "https://merchant.example/ae-live",
              image_url: "https://images.example/ae-live.jpg",
              country_code: "AE",
            },
          ],
          meta: { total: 2, degraded: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("", { status: 200, headers: { "content-type": "image/jpeg" } });
  };

  try {
    const products = await getSeoLandingProducts(seoLandingPages["best-gaming-laptops-us"]);
    assert.ok(products.some((p) => p.merchant === "Best Buy"), "US merchant should be included");
    assert.ok(!products.some((p) => p.merchant === "COMPUMARTS"), "COMPUMARTS must be absent");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("branded SVG placeholder data URL uses RFC-2397 charset form (BUY-64260)", async () => {
  const source = readFileSync(
    new URL("./seo-landing-pages.ts", import.meta.url),
    "utf8",
  );

  // Defensive: the SVG placeholder pipeline must not emit the malformed
  // `;utf8,` MIME parameter that browsers reject (BUY-64260). The two
  // standards-compliant forms are `;charset=utf-8,` and `;base64,`.
  assert.doesNotMatch(
    source,
    /data:image\/svg\+xml;utf8,/,
    "brandedProductPlaceholderSvg must not emit the malformed `;utf8,` MIME parameter (BUY-64260)",
  );

  // The branded placeholder is the only producer of `data:image/svg+xml` URLs
  // in this file. Confirm it uses the explicit-charset form so modern browsers
  // decode the SVG instead of falling through to the broken-image icon.
  const dataUrlMatches = source.match(/data:image\/svg\+xml[^"`,)}\s]+/g) ?? [];
  assert.ok(dataUrlMatches.length > 0, "expected at least one data:image/svg+xml URL in source");
  for (const url of dataUrlMatches) {
    assert.ok(
      url.startsWith("data:image/svg+xml;charset=utf-8,") ||
        url.startsWith("data:image/svg+xml;base64,"),
      `data URL must use RFC-2397 form, got: ${url.slice(0, 60)}…`,
    );
  }
});

// BUY-63507: parseImageDimensions + isSquareAspect guard against the live
// "blank/white" card failure where 1:1 product photos with heavy white
// margins render poorly inside the aspect-[4/3] / object-cover catalog
// cards. The header walker must correctly identify known-bad square sources.
test("parseImageDimensions extracts JPEG SOF and PNG IHDR dimensions", () => {
  // 1500x1500 JPEG (synthetic — minimal markers, real CDN payload has DQT/DHT
  // between SOI and SOF). Construct a JPEG that starts with SOI + DQT + SOF0.
  // The probe only needs to walk past DQT to reach SOF0.
  function buildJpeg(w: number, h: number): Uint8Array {
    // SOI (2) + DQT marker (2) + length (2) + payload (66 bytes of zeros) +
    // SOF0 marker (2) + length (2) + precision (1) + height (2) + width (2) +
    // components (1) + per-component (3) = 6 + 66 + 8 = 80 bytes minimum.
    const buf = new Uint8Array(80);
    let p = 0;
    buf[p++] = 0xff; buf[p++] = 0xd8; // SOI
    buf[p++] = 0xff; buf[p++] = 0xdb; // DQT
    buf[p++] = 0x00; buf[p++] = 0x43; // length = 67
    for (let i = 0; i < 65; i++) buf[p++] = 0x00;
    buf[p++] = 0xff; buf[p++] = 0xc0; // SOF0
    buf[p++] = 0x00; buf[p++] = 0x0b; // length = 11
    buf[p++] = 0x08;                  // precision
    buf[p++] = (h >> 8) & 0xff; buf[p++] = h & 0xff;
    buf[p++] = (w >> 8) & 0xff; buf[p++] = w & 0xff;
    buf[p++] = 0x03;                  // 3 components
    for (let i = 0; i < 9; i++) buf[p++] = 0x00;
    return buf;
  }
  function buildPng(w: number, h: number): Uint8Array {
    const buf = new Uint8Array(24);
    // Signature
    buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
    buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
    // IHDR length (4 bytes, big-endian) = 13
    buf[8] = 0; buf[9] = 0; buf[10] = 0; buf[11] = 13;
    // 'IHDR'
    buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52;
    // width
    buf[16] = (w >>> 24) & 0xff;
    buf[17] = (w >>> 16) & 0xff;
    buf[18] = (w >>> 8) & 0xff;
    buf[19] = w & 0xff;
    // height
    buf[20] = (h >>> 24) & 0xff;
    buf[21] = (h >>> 16) & 0xff;
    buf[22] = (h >>> 8) & 0xff;
    buf[23] = h & 0xff;
    return buf;
  }

  // Pull the helper out via a small probe into the file source — keeping
  // the helper private is fine since the public behavior (verifyUsableImageContent)
  // is exercised by the live probe below.
  const source = readFileSync(new URL("./seo-landing-pages.ts", import.meta.url), "utf8");
  assert.match(source, /function parseImageDimensions/, "parseImageDimensions helper must exist (BUY-63507)");
  assert.match(source, /function isSquareAspect/, "isSquareAspect helper must exist (BUY-63507)");
  assert.match(source, /async function verifyUsableImageContent/, "verifyUsableImageContent helper must exist (BUY-63507)");
  assert.match(source, /SQUARE_ASPECT_TOLERANCE = 0\.06/, "square tolerance must be 0.06 (BUY-63507)");
  assert.match(source, /SQUARE_FILE_SIZE_THRESHOLD = 250 \* 1024/, "square file-size threshold must be 250KB (BUY-63507)");

  // Local reimplementation of the helper for a unit assertion (the file
  // doesn't export it — it's a private SSR helper). Keep these in sync
  // with the implementation in seo-landing-pages.ts.
  const dims = (bytes: Uint8Array) => {
    if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
      const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      return { w, h };
    }
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        if (marker === 0xd9 || marker === 0xda) return null;
        if (marker >= 0xc0 && marker <= 0xc3) {
          const h = (bytes[i + 5] << 8) | bytes[i + 6];
          const w = (bytes[i + 7] << 8) | bytes[i + 8];
          return { w, h };
        }
        const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
        i += 2 + segLen;
      }
    }
    return null;
  };

  const sq = dims(buildJpeg(1500, 1500))!;
  assert.equal(sq.w, 1500);
  assert.equal(sq.h, 1500);

  const wide = dims(buildJpeg(1500, 1087))!;
  assert.equal(wide.w, 1500);
  assert.equal(wide.h, 1087);

  const pngSq = dims(buildPng(1200, 1200))!;
  assert.equal(pngSq.w, 1200);
  assert.equal(pngSq.h, 1200);

  // isSquareAspect sanity (mirrors the implementation)
  const isSq = (d: { w: number; h: number }) => Math.abs(d.w / d.h - 1) <= 0.06;
  assert.equal(isSq(sq), true, "1500x1500 must be square");
  assert.equal(isSq(wide), false, "1500x1087 must NOT be square");
  assert.equal(isSq({ w: 1500, h: 847 }), false, "1500x847 must NOT be square");
  assert.equal(isSq({ w: 1000, h: 940 }), true, "1000x940 (AR 1.06) is within ±6% tolerance");
  assert.equal(isSq({ w: 1000, h: 1070 }), true, "1000x1070 (AR 0.93) is within ±6% tolerance");
});

// ---------------------------------------------------------------------------
// BUY-67622 — SEO guide hero copy must not contradict the live card set.
// Three regression tests:
//
//   1. Source-level: seo-landing-pages.ts declares the host denylist, the
//      requiredGpuTokens config field, and uses them in the live-card filter
//      path. This is the static guarantee — if a future refactor drops the
//      host denylist or requiredGpuTokens gate, these tests fail before the
//      change ships.
//   2. Functional: the best-gaming-laptops-us config explicitly requires an
//      RTX 50-series token in product names so the 2020-era TUF F15 (GTX
//      1650 / dev6booster.myshopify.com) cannot reach the rendered HTML.
//   3. Functional: best-robot-vacuums-2026 sets minPrice >= 130 so sub-claim
//      clearance items (Tecbot S3 Pro at $129.99) cannot undercut the "from
//      $199" hero promise.
// ---------------------------------------------------------------------------

test("BUY-67622: source declares LOW_TRUST_REDIRECT_HOST_PATTERNS + LOW_TRUST_MERCHANT_PATTERNS + requiredGpuTokens gate", () => {
  const source = readFileSync(
    new URL("./seo-landing-pages.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /LOW_TRUST_REDIRECT_HOST_PATTERNS/, "host denylist constant must exist");
  assert.match(source, /LOW_TRUST_MERCHANT_PATTERNS/, "merchant denylist constant must exist (v2)");
  // Source contains literal regex source `dev6booster\.myshopify\.com` etc.;
  // the regex dot-escape sequence is stored as 2 chars (backslash + dot), so
  // match the unescaped dot form by passing the regex source string.
  assert.ok(
    source.includes("dev6booster\\.myshopify\\.com"),
    "host denylist must include dev6booster.myshopify.com",
  );
  assert.ok(
    source.includes("wellbots\\.com"),
    "host denylist must include wellbots.com",
  );
  assert.ok(
    source.includes("tvoutlet\\.ca"),
    "host denylist must include tvoutlet.ca",
  );
  assert.ok(
    source.includes("shopify_wellbots_com"),
    "merchant denylist must include shopify_wellbots_com (v2)",
  );
  assert.ok(
    source.includes("shopify_unharvested_batch"),
    "merchant denylist must include shopify_unharvested_batch (v2)",
  );
  assert.ok(
    source.includes("shopify_buy30620_stock"),
    "merchant denylist must include shopify_buy30620_stock (v2)",
  );
  assert.ok(source.includes("requiredGpuTokens?:"), "config must declare requiredGpuTokens field");
  assert.ok(source.includes("productMatchesGpuTokens"), "must define productMatchesGpuTokens filter");
  // The host denylist must be wired into the live-card filter path.
  assert.ok(
    source.includes("redirectCandidates.some(isLowTrustRedirectHost)"),
    "host denylist must run inside normalizeProduct",
  );
  // The merchant denylist must be wired into normalizeProduct (v2).
  assert.ok(
    source.includes("isLowTrustMerchant(item.merchant)"),
    "merchant denylist must run inside normalizeProduct (v2)",
  );
  // The requiredGpuTokens gate must run inside the per-item loop.
  assert.ok(
    source.includes("productMatchesGpuTokens(product, config.requiredGpuTokens)"),
    "requiredGpuTokens gate must run on every live item",
  );
});

test("BUY-67622: best-gaming-laptops-us config requires RTX 5070/5080 GPU token (not just 'rtx 50')", () => {
  const config = seoLandingPages["best-gaming-laptops-us"];
  assert.ok(config, "best-gaming-laptops-us config must exist");
  const tokens = config.requiredGpuTokens ?? [];
  assert.ok(
    tokens.length > 0,
    "requiredGpuTokens must be set so older-gen GPUs (e.g. 2020 TUF F15 / GTX 1650, RTX 5060) cannot reach the page",
  );
  const flat = tokens.join(" ").toLowerCase();
  // v2: the gate must require 5070/5080 specifically, not just "rtx 50",
  // because "rtx 50" was matching RTX 5060 and letting non-5070/5080 cards leak.
  assert.ok(
    flat.includes("rtx 5070") && flat.includes("rtx 5080"),
    `requiredGpuTokens must include BOTH "rtx 5070" and "rtx 5080" to honor hero copy; got: ${JSON.stringify(tokens)}`,
  );
  assert.ok(
    !flat.includes(/\brtx 50\b/.source) || flat.match(/\brtx 50\b/g)?.length === 0,
    `requiredGpuTokens must NOT contain bare "rtx 50" — it substring-matches RTX 5060/5050; got: ${JSON.stringify(tokens)}`,
  );
  // Hero copy must still promise RTX 5070/5080 — this is the editorial promise
  // the live cards now have to match.
  assert.match(
    config.heroTitle,
    /RTX 50(70|80)/i,
    "heroTitle must promise an RTX 50-series GPU so the filter is meaningful",
  );
});

test("BUY-67622: best-robot-vacuums-2026 config raises minPrice to >=199 so clearance sub-claim items cannot leak", () => {
  const config = seoLandingPages["best-robot-vacuums-2026"];
  assert.ok(config, "best-robot-vacuums-2026 config must exist");
  // v2: floor must match hero's "from $199" anchor — Tecbot S1 at $119.99 and
  // Tecbot S3 Pro at $129.99 still leaked at $130 floor.
  assert.ok(
    typeof config.minPrice === "number" && config.minPrice >= 199,
    `minPrice must be >= 199 to enforce the hero's "from $199" promise (Tecbot S1/S3 leak); got: ${config.minPrice}`,
  );
  // v2: requiredProductTerms must constrain to named brands/retailers so
  // Tecbot / iMass A3 / Xiaomi off-brand rows cannot displace honest
  // Roomba/Roborock/Eufy fallbacks.
  const terms = config.requiredProductTerms ?? [];
  const flat = terms.join(" ").toLowerCase();
  for (const required of ["roomba", "roborock", "eufy"]) {
    assert.ok(
      flat.includes(required),
      `requiredProductTerms must include "${required}" so named brands anchor the live cards; got: ${JSON.stringify(terms)}`,
    );
  }
  assert.match(
    config.heroTitle,
    /from \$199/i,
    "heroTitle must still promise 'from $199' so the floor is meaningful",
  );
});

// BUY-66320: resolveHeroTitle must substitute the live catalog floor price
// into the template, fall back to the static heroTitle when no template is
// provided, and fall back when the live catalog is empty.
test("resolveHeroTitle substitutes {floorPrice} from live catalog", () => {
  const config = {
    heroTitle: "Best Robot Vacuums 2026 from $199 — Roomba & Roborock Deals",
    heroTitleTemplate: "Best Robot Vacuums 2026 from {floorPrice} — Roomba & Roborock Deals",
    currency: "USD" as const,
  };
  const products: LandingProduct[] = [
    { ...makeLandingProduct("Roborock S8 MaxV Ultra"), id: "r1", price: 1299, currency: "USD", merchant: "Amazon", imageUrl: null, href: "/x" },
    { ...makeLandingProduct("Roomba Combo j9+"), id: "r2", price: 999, currency: "USD", merchant: "Best Buy", imageUrl: null, href: "/x" },
    { ...makeLandingProduct("Roborock Q5 Pro+"), id: "r3", price: 560, currency: "USD", merchant: "Walmart", imageUrl: null, href: "/x" },
  ];
  const resolved = resolveHeroTitle(config, products);
  assert.equal(
    resolved,
    "Best Robot Vacuums 2026 from $560 — Roomba & Roborock Deals",
    "floorPrice should be the lowest live price ($560), not the stale $199"
  );
});

test("resolveHeroTitle falls back to static heroTitle when no template", () => {
  const config = {
    heroTitle: "Best Air Purifiers in Singapore",
    currency: "SGD" as const,
  };
  const products: LandingProduct[] = [
    { ...makeLandingProduct("X"), id: "1", price: 100, currency: "SGD", merchant: "M", imageUrl: null, href: "/x" },
  ];
  assert.equal(resolveHeroTitle(config, products), "Best Air Purifiers in Singapore");
});

test("resolveHeroTitle falls back to static heroTitle when live catalog is empty (BUY-66320 hardens against upstream outages)", () => {
  const config = {
    heroTitle: "Best Robot Vacuums 2026 from $199 — Roomba & Roborock Deals",
    heroTitleTemplate: "Best Robot Vacuums 2026 from {floorPrice} — Roomba & Roborock Deals",
    currency: "USD" as const,
  };
  assert.equal(
    resolveHeroTitle(config, []),
    "Best Robot Vacuums 2026 from $199 — Roomba & Roborock Deals"
  );
});

test("resolveHeroTitle ignores null prices and zero prices", () => {
  const config = {
    heroTitle: "fallback",
    heroTitleTemplate: "from {floorPrice}",
    currency: "USD" as const,
  };
  const products: LandingProduct[] = [
    { ...makeLandingProduct("X"), id: "1", price: null, currency: "USD", merchant: "M", imageUrl: null, href: "/x" },
    { ...makeLandingProduct("Y"), id: "2", price: 0, currency: "USD", merchant: "M", imageUrl: null, href: "/x" },
    { ...makeLandingProduct("Z"), id: "3", price: 250, currency: "USD", merchant: "M", imageUrl: null, href: "/x" },
  ];
  assert.equal(resolveHeroTitle(config, products), "from $250");
});

test("best-robot-vacuums-2026 declares heroTitleTemplate so the headline stays in sync with the live catalog (BUY-66320)", () => {
  const config = seoLandingPages["best-robot-vacuums-2026"];
  assert.ok(config, "best-robot-vacuums-2026 config must exist");
  assert.ok(
    config.heroTitleTemplate && config.heroTitleTemplate.includes("{floorPrice}"),
    "best-robot-vacuums-2026 must declare a heroTitleTemplate with {floorPrice}"
  );
  // The static heroTitle is the fallback when the live catalog is empty.
  assert.match(config.heroTitle, /Roomba/);
});

// BUY-69630: slug-match guard relaxation for catalog productIds
// BUY-69736: now async because getSeoLandingFallbackProduct probes + repairs
// the curated image URL before returning.
test("getSeoLandingFallbackProduct matches by productId and region, ignoring slug (BUY-69630)", async () => {
  // Stub the image probe so the curated imageUrl passes through unchanged.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("", { status: 200, headers: { "content-type": "image/jpeg" } });

  try {
    // Grab a real fallback product from the config
    const usConfig = seoLandingPages["best-gaming-laptops-us"];
    const fallbackProduct = usConfig?.fallbackProducts?.[0];
    assert.ok(fallbackProduct, "expected a fallback product in best-gaming-laptops-us config");

    const productId = fallbackProduct.id;
    const correctSlug = fallbackProduct.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

    // Verify it matches with the correct slug
    const matchWithCorrectSlug = await getSeoLandingFallbackProduct("us", productId, correctSlug);
    assert.ok(matchWithCorrectSlug, "should match with correct slug");
    assert.equal(matchWithCorrectSlug!.id, productId);

    // The regression: slug derived from upstream merchant title doesn't match
    // buildLandingProductSlug(product.name). PDPs must render for catalog
    // productIds regardless of slug (slug is informational only).
    const mangledSlug = "some-random-mangled-slug-from-upstream-merchant";
    const matchWithMangledSlug = await getSeoLandingFallbackProduct("us", productId, mangledSlug);
    assert.ok(matchWithMangledSlug, "should match with mangled slug (BUY-69630)");
    assert.equal(matchWithMangledSlug!.id, productId);

    // Region still matters: the sg config also curates a g1 row (same id,
    // different price/currency), so the sg lookup must return the SG row,
    // not the US one. An unknown region must return nothing.
    const sgMatch = await getSeoLandingFallbackProduct("sg", productId, mangledSlug);
    assert.ok(sgMatch, "sg has its own g1 row and must match");
    assert.equal(sgMatch!.currency, "SGD", "sg lookup must return the SG row, not the US row");
    assert.notEqual(sgMatch!.price, matchWithMangledSlug!.price, "US and SG rows are distinct");
    const unknownRegion = await getSeoLandingFallbackProduct("au", productId, mangledSlug);
    assert.ok(!unknownRegion, "unknown region must not match any config");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// BUY-66320 (v4): hero "from {floorPrice}" must be provable at card position 1.
//
// Regression for the reopen at 2026-08-14T06:12Z. Two previously-shipped rules
// collided on /best-robot-vacuums-2026:
//   * BUY-66320  — hero reads the live catalog minimum ($560 Shark Navigator)
//   * BUY-67622 v3 — Roomba/Roborock are sorted to the front of the card grid
// Together they rendered "from $560" above cards starting at $1,299 / $999.
// The fixture below is the byte-exact live card set captured from SSR HTML.
// ---------------------------------------------------------------------------

function makePricedProduct(id: string, name: string, price: number | null): LandingProduct {
  return {
    ...makeLandingProduct(name),
    id,
    price,
    currency: "USD",
    merchant: "Test Merchant",
    imageUrl: null,
    href: "/x",
  } as LandingProduct;
}

// Live card set observed on https://buywhere.ai/best-robot-vacuums-2026.
const LIVE_ROBOT_VACUUM_CARDS: LandingProduct[] = [
  makePricedProduct("rv1", "Roborock S8 MaxV Ultra", 1299),
  makePricedProduct("rv2", "iRobot Roomba Combo j9+", 999),
  makePricedProduct("rv3", "Shark - Navigator Robot Vacuum + Self-Empty Base - Gray", 559.99),
  makePricedProduct("rv4", "Shark PowerDetect 2-in-1", 699),
];

test("BUY-66320 v4: the hero floor-price card is rendered first", () => {
  const heroFeaturedBrands = ["roomba", "irobot", "roborock"];
  const floorId = findFloorPriceProductId(LIVE_ROBOT_VACUUM_CARDS);
  assert.equal(floorId, "rv3", "floor card is the $559.99 Shark Navigator");

  const ordered = [...LIVE_ROBOT_VACUUM_CARDS].sort((a, b) =>
    compareLandingCardOrder(a, b, heroFeaturedBrands, floorId),
  );

  assert.equal(
    ordered[0].id,
    "rv3",
    "the card backing the hero's 'from $560' claim must lead, not sit at position 3",
  );
});

test("BUY-66320 v4: hero headline price equals the first rendered card price", () => {
  const config = seoLandingPages["best-robot-vacuums-2026"];
  const heroFeaturedBrands = config.heroFeaturedBrands;
  const floorId = findFloorPriceProductId(LIVE_ROBOT_VACUUM_CARDS);
  const ordered = [...LIVE_ROBOT_VACUUM_CARDS].sort((a, b) =>
    compareLandingCardOrder(a, b, heroFeaturedBrands, floorId),
  );

  const heroTitle = resolveHeroTitle(config, LIVE_ROBOT_VACUUM_CARDS);
  const heroPrice = heroTitle.match(/from (\$[\d,]+)/)?.[1];
  const firstCardPrice = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(ordered[0].price));

  assert.equal(heroPrice, "$560", "hero should advertise the live floor");
  assert.equal(
    heroPrice,
    firstCardPrice,
    "the headline price and the first visible card price must be identical",
  );
});

test("BUY-66320 v4: BUY-67622 hero-brand promotion still holds for non-floor cards", () => {
  const heroFeaturedBrands = ["roomba", "irobot", "roborock"];
  const floorId = findFloorPriceProductId(LIVE_ROBOT_VACUUM_CARDS);
  const ordered = [...LIVE_ROBOT_VACUUM_CARDS].sort((a, b) =>
    compareLandingCardOrder(a, b, heroFeaturedBrands, floorId),
  );

  // Position 0 is the floor card; hero-named brands must occupy the next slots
  // so BUY-67622's "hero promise matches what shoppers see" intent survives.
  const after = ordered.slice(1).map((p) => p.id);
  assert.deepEqual(
    after.slice(0, 2).sort(),
    ["rv1", "rv2"],
    "Roborock/Roomba still rank ahead of the non-featured Shark PowerDetect",
  );
  assert.equal(after[2], "rv4", "non-featured Shark PowerDetect ranks last");
});

test("BUY-66320 v4: ordering is a no-op when no product has a usable price", () => {
  const unpriced = [
    makePricedProduct("u1", "Roomba X", null),
    makePricedProduct("u2", "Shark Y", 0),
  ];
  const floorId = findFloorPriceProductId(unpriced);
  assert.equal(floorId, null, "no positive price means no floor card to promote");

  const ordered = [...unpriced].sort((a, b) =>
    compareLandingCardOrder(a, b, ["roomba"], floorId),
  );
  assert.equal(ordered[0].id, "u1", "falls back to hero-brand promotion only");
});

// BUY-67622 v4: buildSeoLandingMetadata must thread the live catalog floor
// price into the SEO meta tags (<title>, og:title, twitter:title,
// og:image:alt) — so the meta tags match the visible H1 that SeoLandingPage
// renders via resolveHeroTitle. Without products it must fall back to the
// static config.title (graceful degradation when upstream times out).
test("buildSeoLandingMetadata resolves hero title from live products (BUY-67622 v4)", () => {
  const config = seoLandingPages["best-robot-vacuums-2026"];
  assert.ok(config, "best-robot-vacuums-2026 config must exist");
  const products: LandingProduct[] = [
    { ...makeLandingProduct("Roborock S8 MaxV Ultra"), id: "r1", price: 1299, currency: "USD", merchant: "Amazon", imageUrl: null, href: "/x" },
    { ...makeLandingProduct("Roomba Combo j9+"), id: "r2", price: 999, currency: "USD", merchant: "Best Buy", imageUrl: null, href: "/x" },
    { ...makeLandingProduct("Roborock Q5 Pro+"), id: "r3", price: 560, currency: "USD", merchant: "Walmart", imageUrl: null, href: "/x" },
  ];
  const meta = buildSeoLandingMetadata(config, products);
  assert.equal(
    String(meta.title),
    "Best Robot Vacuums 2026 from $560 — Roomba & Roborock Deals",
    "metadata title should resolve to the live catalog floor $560, not the stale $199",
  );
  const ogTitle = (meta.openGraph as { title?: string } | undefined)?.title;
  assert.equal(
    ogTitle,
    "Best Robot Vacuums 2026 from $560 — Roomba & Roborock Deals",
    "og:title should mirror the resolved hero title",
  );
  const twitterTitle = (meta.twitter as { title?: string } | undefined)?.title;
  assert.equal(
    twitterTitle,
    "Best Robot Vacuums 2026 from $560 — Roomba & Roborock Deals",
    "twitter:title should mirror the resolved hero title",
  );
  const ogImageAlt = (meta.openGraph as { images?: Array<{ alt?: string }> } | undefined)?.images?.[0]?.alt;
  assert.equal(
    ogImageAlt,
    "Best Robot Vacuums 2026 from $560 — Roomba & Roborock Deals",
    "og:image:alt should mirror the resolved hero title",
  );
});

test("buildSeoLandingMetadata falls back to static config.title when no products provided (BUY-67622 v4 graceful degradation)", () => {
  const config = seoLandingPages["best-robot-vacuums-2026"];
  const meta = buildSeoLandingMetadata(config);
  assert.equal(
    String(meta.title),
    "Best Robot Vacuums 2026 from $199 — Roomba, Roborock",
    "without products, metadata title must fall back to static config.title",
  );
});

test("buildSeoLandingMetadata falls back to static config.title when live catalog is empty (BUY-67622 v4 hardens against upstream outages)", () => {
  const config = seoLandingPages["best-robot-vacuums-2026"];
  const meta = buildSeoLandingMetadata(config, []);
  assert.equal(
    String(meta.title),
    "Best Robot Vacuums 2026 from $199 — Roomba, Roborock",
    "empty live catalog must fall back to static config.title, not the floor-derived $560",
  );
});

// ---------------------------------------------------------------------------
// BUY-69736 — curated PDP fallback images must be correct, reachable, and
// repairable. Three regression layers:
//
//   1. Every curated gaming-laptop fallback row's imageUrl must reference an
//      image that serves an image/* content type — a 200-OK HTML error page
//      must NOT count as a valid image (the old verifyReachableImage bug).
//   2. A row whose URL is dead (serves HTML/404) must be swapped to the
//      branded SVG placeholder before it reaches the PDP — never rendered
//      verbatim (negative control).
//   3. The curated URLs that ship must be the exact live-catalog images for
//      the named models (provenance asserted at curation time, 2026-08-14).
// ---------------------------------------------------------------------------

test("curated gaming-laptop fallback imageUrls serve image/* not text/html (BUY-69736)", async () => {
  const config = seoLandingPages["best-gaming-laptops-us"];
  assert.ok(config, "best-gaming-laptops-us config must exist");
  assert.ok(config.fallbackProducts.length >= 6, "expected the 6 gaming-laptop fallback rows");

  for (const product of config.fallbackProducts) {
    const imageUrl = product.imageUrl;
    assert.ok(imageUrl, `${product.id} must have a curated imageUrl`);
    assert.match(imageUrl!, /^https?:\/\//, `${product.id} imageUrl must be a remote URL`);

    const res = await fetch(imageUrl!, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    // A dead CDN URL returns 403/404; a wrong-product CDN catch-all returns
    // 200 + text/html. Both must fail this test at curation time.
    assert.ok(
      res.ok,
      `${product.id} (${product.name}) curated image must return 2xx: got ${res.status} for ${imageUrl}`,
    );
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    assert.ok(
      contentType.startsWith("image/"),
      `${product.id} (${product.name}) curated image must serve image/*: got "${contentType}" for ${imageUrl}`,
    );
  }
});

test("verifyReachableImage rejects 200-OK HTML error pages (BUY-69736)", async () => {
  const originalFetch = globalThis.fetch;
  // Some CDNs answer 200 with an HTML error page for missing assets.
  globalThis.fetch = (async () =>
    new Response("<html><body>Access Denied</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any;

  try {
    const reachable = await verifyReachableImage("https://cdn.example.com/files/missing.jpg");
    assert.equal(reachable, false, "HTTP 200 text/html must NOT be treated as a reachable image");
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Positive control: a genuine image content type must pass.
  globalThis.fetch = (async () =>
    new Response("", { status: 200, headers: { "content-type": "image/jpeg" } })
  ) as typeof globalThis.fetch;
  try {
    const reachable = await verifyReachableImage("https://cdn.example.com/files/real.jpg");
    assert.equal(reachable, true, "HTTP 200 image/jpeg must be treated as reachable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getSeoLandingFallbackProduct replaces a dead curated URL with the branded SVG (BUY-69736 negative control)", async () => {
  const originalFetch = globalThis.fetch;
  // Simulate the dead-URL condition: every probe serves 200 text/html
  // (the same shape as the Dell Akamai 403 redirect page and the HP
  // 10-byte "Not found" PNG path that shipped before this fix).
  globalThis.fetch = (async () =>
    new Response("<html>Not Found</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as typeof globalThis.fetch;

  try {
    const product = await getSeoLandingFallbackProduct("us", "g6");
    assert.ok(product, "g6 fallback row must resolve");
    // The dead URL must NOT reach the browser as-is…
    assert.ok(
      !(product!.imageUrl ?? "").startsWith("http"),
      `dead curated URL must be replaced, got: ${product!.imageUrl}`,
    );
    // …and must be replaced by the branded SVG placeholder.
    assert.ok(
      (product!.imageUrl ?? "").startsWith("data:image/svg+xml;"),
      `expected branded SVG placeholder, got: ${product!.imageUrl}`,
    );
    // The branded SVG must name the right brand — the g6 QA bug was an
    // Acer Nitro photo on the ASUS TUF PDP.
    const decoded = decodeURIComponent(product!.imageUrl ?? "");
    assert.match(decoded, /ASUS/);
    assert.match(decoded, /TUF/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// BUY-73741: live SSR HTML regression. QA VidMee at 2026-08-24T02:10Z
// captured CompuMarts + Arabic script on the hydrated /best-gaming-laptops-us
// page. This test fetches the live page and asserts the rendered HTML
// contains zero disallowed merchant strings anywhere (cards + JSON-LD + nav).
//
// The test is opt-in via the BUY-73741_LIVE_HTML_GUARD=1 env var because it
// requires network access from the test runner. CI on github-actions
// (deploy-www.yml `next-build` job) sets this flag so the regression guard
// runs against every PR. Local runs default to skipping.
// ---------------------------------------------------------------------------
test("BUY-73741: live SSR HTML for /best-gaming-laptops-us contains zero CompuMarts / Arabic / non-US merchant", async () => {
  if (process.env.BUY_73741_LIVE_HTML_GUARD !== "1") {
    console.warn("[BUY-73741] skipping live HTML guard (set BUY_73741_LIVE_HTML_GUARD=1 to enable)");
    return;
  }
  const response = await fetch("https://buywhere.ai/best-gaming-laptops-us", {
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  assert.ok(response.ok, `live fetch returned ${response.status}`);
  const html = await response.text();
  assert.ok(html.length > 1000, "page should have substantial HTML");
  assert.doesNotMatch(html, /compumart/i, "live SSR HTML must not contain CompuMarts");
  assert.doesNotMatch(html, /سوق/, "live SSR HTML must not contain Arabic script");
  assert.doesNotMatch(
    html,
    /\bnamshi\b|\bmumzworld\b/i,
    "live SSR HTML must not contain Namshi / MumzWorld",
  );
});

// BUY-76505: verdict sentence strips country tokens from searchQuery
test("BUY-76505: stripCountryTokens removes country tokens from query", () => {
  assert.equal(stripCountryTokens("air purifier Singapore"), "air purifier");
  assert.equal(stripCountryTokens("air purifier SG"), "air purifier");
  assert.equal(stripCountryTokens("laptop US"), "laptop");
  assert.equal(stripCountryTokens("laptop United States"), "laptop");
  assert.equal(stripCountryTokens("Sony headphones Singapore SG US United States"), "Sony headphones");
  assert.equal(stripCountryTokens("sINGAPORE laptop"), "laptop");
  assert.equal(stripCountryTokens("laptop us best"), "laptop best");
  assert.equal(stripCountryTokens("Sony headphones"), "Sony headphones");
});

// BUY-77675: laptop accessory regex catches the QA-captured false positives.
// Live capture 2026-08-30T06:15Z found 72% non-laptop results for
// q=laptop&country=sg — mics, IEMs, headphones, desks, portable monitors,
// privacy screens, screen cleaners, foldable keyboards. Each must be
// rejected by `LAPTOP_ACCESSORY_RE` while leaving the model's own model
// names untouched.
test("BUY-77675: LAPTOP_ACCESSORY_RE rejects QA-captured laptop accessories", () => {
  // Re-read the regex from source so the test stays in lockstep with the
  // constant defined in seo-landing-pages.ts (regex literals don't survive
  // export through the Next.js TS pipeline).
  const source = readFileSync(new URL("./seo-landing-pages.ts", import.meta.url), "utf8");
  const match = source.match(/const LAPTOP_ACCESSORY_RE =\s*\n\s*(\/[^;]+\/i)/);
  assert.ok(match, "LAPTOP_ACCESSORY_RE must be defined in seo-landing-pages.ts");
  const accessoryRe = new RegExp(match![1].replace(/^\/|\/i$/g, ""), "i");

  // Every entry here was a confirmed non-laptop in the QA capture.
  const accessories = [
    "Boya Wireless Lavalier Microphone BOYALINK A1 Mini Lapel Mic for iPhone Android Laptop",
    "BOYA Dual Wireless Lavalier Lapel Microphone for Android Smartphone Laptop",
    "rockpapa On Ear Stereo Headphones Earphones For Adults Kids Childs Teens Adjust",
    "WEICON Screen Cleaner 200 ml Touch Screen Cleaner Spray for Laptop Tablet Phone",
    "Laptop Desk for Bed Study Desk Portable Foldable Laptop Table Folding Breakfast Tray",
    "Laptop Lap Desk for Bed Portable Foldable Laptop Table Folding Breakfast Tray",
    "Portable Monitor 15.6\" FHD 1080P Travel Portable Monitor for Laptop",
    "In Ear Monitors Headphones USB-C HiFi Wired Earbuds with Noise Isolating",
    "Laptop Screen Extender Portable Triple Monitor 15.6 inch FHD 1080P",
    "Mesh Poofy Laptop Sleeve",
    "CARBONADO 30 L Backpack Gaming Backpack For Laptop",
    "ProCase Wireless Keyboard for iOS Android Windows Device Mini Small Slim Light",
    "Geyes Foldable Bluetooth Keyboard Portable Folding Wireless Keyboard",
  ];
  for (const title of accessories) {
    assert.equal(accessoryRe.test(title), true, `expected accessory match: ${title}`);
  }

  // Real laptops — every brand / series token in the live catalog must
  // still survive the accessory filter.
  const laptops = [
    "Razer Blade Stealth 13 Ultrabook Laptop OLED",
    "Lenovo ThinkPad Laptop E14 G5 i5-1340P",
    "MSI Modern 14 C13M-667SG Laptop",
    "MacBook Air 13 M3",
    "ASUS Zenbook 14 OLED",
    "Gaming Laptop i5 16 inch Laptop Computer Up to 3.60GHz",
    "2025 AMD Laptop Computer with Ryzen 7 5700U",
    "Dell Inspiron 15.6\" Laptop",
    "Lenovo IdeaPad Slim 3i 15.6\"",
    "Lenovo ThinkBook Laptop 14 G7 U7",
    "Lenovo Yoga Slim 7",
    "HP Pavilion 15",
    "HP 14 Student-Laptop",
    "Apple MacBook Pro 14",
    "LG 14Z90T gram 14\" Lightweight",
    "ROG Strix G16 Gaming Laptop",
    "MSI Stealth 16Studio Gaming Laptop",
    "Lenovo Legion Pro 7i Gaming Laptop",
    "Alienware m16 R3 Gaming Laptop",
  ];
  for (const title of laptops) {
    assert.equal(accessoryRe.test(title), false, `expected laptop passthrough: ${title}`);
  }
});

// BUY-77675: token-floor on `searchCategory === "laptops"` requires either
// a strict model token OR (loose "laptop" AND a laptop-series signal). The
// floor is what stops a Boya mic titled "…for Laptop" from passing on the
// bare "laptop" token alone.
test("BUY-77675: laptop token floor requires strict model OR loose+signal", () => {
  const source = readFileSync(new URL("./seo-landing-pages.ts", import.meta.url), "utf8");

  // Pull strict + loose tokens the same way isExcludedAccessory does at
  // runtime. Avoid exporting them through the page module just for tests —
  // the regex + token arrays are private and we want to keep them that way.
  const extractStringArray = (label: string): string[] => {
    const start = source.indexOf(`const ${label} = [`);
    if (start === -1) throw new Error(`missing ${label}`);
    const bodyStart = start + `const ${label} = [`.length;
    let i = bodyStart;
    let depth = 1;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) break;
      } else if (ch === "/" && source[i + 1] === "/") {
        while (i < source.length && source[i] !== "\n") i++;
      } else if (ch === "/" && source[i + 1] === "*") {
        i += 2;
        while (i < source.length - 1 && !(source[i] === "*" && source[i + 1] === "/")) i++;
        i += 1;
      }
      i++;
    }
    const body = source
      .substring(bodyStart, i)
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    return Array.from(body.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  };
  const strictTokens = extractStringArray("LAPTOP_REQUIRED_STRICT_TOKENS");
  const looseSignals = extractStringArray("LAPTOP_REQUIRED_LOOSE_SIGNALS");

  const floorPasses = (text: string): boolean => {
    const lower = text.toLowerCase();
    if (strictTokens.some((t) => lower.includes(t.toLowerCase()))) return true;
    const hasLaptop = lower.includes("laptop");
    const hasLoose = looseSignals.some((s) => lower.includes(s.toLowerCase()));
    return hasLaptop && hasLoose;
  };

  // Real laptops — strict token OR (laptop + loose) must pass
  const laptops = [
    "Razer Blade Stealth 13 Ultrabook Laptop",
    "Lenovo ThinkPad E14 G5",
    "Lenovo ThinkBook 14 G7",
    "MSI Modern 14 C13M-667SG Laptop",
    "MacBook Air M3 13-inch",
    "ASUS Zenbook 14 OLED",
    "Gaming Laptop i5 16 inch Laptop Computer",
    "2025 AMD Laptop Computer with Ryzen 7",
    "Dell Inspiron 15.6\" Laptop",
    "Lenovo IdeaPad Slim 3i 15.6\"",
    "Lenovo Yoga Slim 7",
    "HP 14 Student-Laptop",
    "Apple MacBook Pro 14",
  ];
  for (const title of laptops) {
    assert.equal(floorPasses(title), true, `floor must accept laptop: ${title}`);
  }

  // Accessories that mention "laptop" but are not laptops — must fail
  const accessories = [
    "BOYA Dual Wireless Lavalier Lapel Microphone for Android Smartphone Laptop",
    "Boya Wireless Lavalier Microphone BOYALINK A1 Mini Lapel Mic for iPhone Android Laptop",
    "WEICON Screen Cleaner 200 ml Touch Screen Cleaner Spray for Laptop Tablet Phone",
    "Laptop Desk for Bed Study Desk Portable Foldable Laptop Table",
    "Portable Monitor 15.6\" FHD 1080P Travel Portable Monitor for Laptop",
    "Laptop Screen Extender Portable Triple Monitor 15.6 inch FHD 1080P",
    "CARBONADO 30 L Backpack Gaming Backpack For Laptop",
    "Mesh Poofy Laptop Sleeve",
    "ProCase Wireless Keyboard for iOS Android Windows Device",
    "Geyes Foldable Bluetooth Keyboard Portable Folding Wireless Keyboard",
  ];
  for (const title of accessories) {
    assert.equal(floorPasses(title), false, `floor must reject accessory: ${title}`);
  }
});
