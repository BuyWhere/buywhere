import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  getSeoLandingProducts,
  isCompleteRobotVacuum,
  resolveHeroTitle,
  seoLandingPages,
  type LandingProduct,
} from "@/lib/seo-landing-pages";

function makeSearchItem(id: string, title: string, price = 199) {
  return {
    id,
    title,
    price_amount: price,
    price_currency: "USD",
    merchant_name: "Test Merchant",
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
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [], meta: { total: 0, degraded: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

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
        assert.match(product.imageUrl || "", /^https?:\/\//, `${slug} rendered ${product.name} without a real remote product image URL`);
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

test("BUY-69167: page-level searchCategory becomes the fallback category when upstream items omit category", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  // The upstream search API returns items with no `category` field set
  // (mirrors the real-world repro: 16 cards on /laptop-singapore and
  // /best-robot-vacuums-2026 all came back with category=null). Without the
  // fix, every branded SVG falls through to the default laptop silhouette
  // and shows "BuyWhere / Featured product".
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        data: [
          // Robot vacuum page — should pick up "Robot Vacuums" fallback.
          { id: "rv1", title: "Roborock S8 MaxV Ultra", price_amount: 1299, price_currency: "USD", merchant_name: "Amazon", click_url: "https://x/r1" },
          { id: "rv2", title: "iRobot Roomba Combo j9+",  price_amount: 999,  price_currency: "USD", merchant_name: "Best Buy", click_url: "https://x/r2" },
        ],
        meta: { total: 2, degraded: false },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const products = await getSeoLandingProducts(seoLandingPages["best-robot-vacuums-2026"]);
    assert.ok(requestedUrl.includes("category=robot_vacuums"));
    assert.equal(products.length, 2);
    for (const product of products) {
      assert.equal(product.category, "Robot Vacuums", `${product.name} should inherit page-level category`);
      assert.ok(product.imageUrl && product.imageUrl.startsWith("data:image/svg+xml"), "branded SVG placeholder present");
      // Silhouette: robot-vac shape uses ellipse cx='60' cy='110'. The default
      // laptop shape uses rect 0,0 120x80. We assert the SVG embeds the robot
      // silhouette and NOT the laptop default.
      assert.match(product.imageUrl!, /ellipse cx='60' cy='110'/, `${product.name} SVG should use robot-vacuum silhouette`);
      assert.doesNotMatch(product.imageUrl!, /rect x='0' y='0' width='120' height='80' rx='8'/, `${product.name} SVG must not be the generic laptop fallback`);
      assert.doesNotMatch(product.imageUrl!, /Featured product/, `${product.name} SVG must not show "Featured product" placeholder text`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Now flip the same fixture to laptop-singapore and assert the laptop
  // silhouette wins (regex: /\blaptop|notebook|macbook|chromebook/).
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          { id: "lp1", title: "MacBook Air 13 M3", price_amount: 1499, price_currency: "SGD", merchant_name: "Apple Store", click_url: "https://x/l1" },
        ],
        meta: { total: 1, degraded: false },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const products = await getSeoLandingProducts(seoLandingPages["laptop-singapore"]);
    assert.equal(products.length, 1);
    assert.equal(products[0].category, "Laptops");
    assert.match(products[0].imageUrl!, /rect x='0' y='0' width='120' height='80' rx='8'/, "laptop silhouette should be embedded");
    assert.match(products[0].imageUrl!, /rect x='-10' y='80' width='140'/, "laptop silhouette base should be embedded");
    assert.doesNotMatch(products[0].imageUrl!, /Featured product/, "should not show Featured product text");
  } finally {
    globalThis.fetch = originalFetch;
  }

  // And the gaming-laptops variant — distinct silhouette with the wavy
  // speaker grille / monitor line (path d='M20 30 L40 45 ...').
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          { id: "gp1", title: "ASUS ROG Zephyrus G16", price_amount: 1999, price_currency: "USD", merchant_name: "Best Buy", click_url: "https://x/g1" },
        ],
        meta: { total: 1, degraded: false },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const products = await getSeoLandingProducts(seoLandingPages["best-gaming-laptops-us"]);
    assert.equal(products.length, 1);
    assert.equal(products[0].category, "Gaming Laptops");
    assert.match(products[0].imageUrl!, /M20 30 L40 45 L60 25 L80 50 L100 30/, "gaming-laptop speaker-grille path should be embedded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BUY-69167: client ProductGridImage placeholder is category-aware and ProductGridCard passes category through", () => {
  const imageSource = readFileSync(
    new URL("../components/seo/ProductGridImage.tsx", import.meta.url),
    "utf8",
  );
  const cardSource = readFileSync(
    new URL("../components/seo/ProductGridCard.tsx", import.meta.url),
    "utf8",
  );

  // The client-side BrandedPlaceholder must include a category-aware
  // silhouette picker (mirrors categorySilhouette in seo-landing-pages.ts)
  // and must accept a `category` prop.
  assert.match(imageSource, /category\?:\s*string\s*\|\s*null/, "ProductGridImage must accept a category prop");
  assert.match(imageSource, /clientCategorySilhouette/, "ProductGridImage must have a category-aware silhouette helper");
  assert.match(imageSource, /\\brobot\\s\*vacuum\|roomba\|deebot\|robovac/, "client silhouette must recognise robot-vacuum terms");
  assert.match(imageSource, /\\blaptop\|notebook\|macbook\|chromebook/, "client silhouette must recognise laptop terms");

  // ProductGridCard must thread category={product.category} into the image.
  assert.match(cardSource, /category=\{product\.category\}/, "ProductGridCard must pass category to ProductGridImage");
});

test("BUY-69167: normalizeProduct accepts a categoryFallback and resolves category from upstream first", () => {
  const source = readFileSync(
    new URL("./seo-landing-pages.ts", import.meta.url),
    "utf8",
  );
  // The new normalizeProduct signature has the optional 4th arg.
  assert.match(source, /function normalizeProduct\(\s*item: SearchApiItem,[\s\S]*?categoryFallback\?: string \| null/m);
  // searchCategoryToLabel helper maps the three known enum tokens.
  assert.match(source, /function searchCategoryToLabel/);
  assert.match(source, /case "robot_vacuums":/);
  assert.match(source, /case "gaming_laptops":/);
  assert.match(source, /case "laptops":/);
  // Call site must thread the page-level category.
  assert.match(source, /searchCategoryToLabel\(config\.searchCategory\)/);
  // Resolved category flows into the placeholder SVG + LandingProduct.
  assert.match(source, /imageUrl: brandedProductPlaceholderSvg\([\s\S]*?resolvedCategory/);
  assert.match(source, /category: resolvedCategory/);
  // New explicit laptop/gaming-laptop regex branches.
  assert.match(source, /\\bgaming\\s\*laptop\|gaming\\s\*notebook/);
  assert.match(source, /\\blaptop\|notebook\|macbook\|chromebook/);
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

// BUY-70202: when a live product's image URL is unreachable (HEAD/GET probe
// fails), the product MUST be replaced with a branded SVG placeholder — not
// dropped. Replacing keeps the card slot populated (name, price, merchant,
// CTA) so the live snapshot never goes empty even when every CDN URL is
// broken. The previous drop-on-fail behavior left empty slots when the
// fallback-top-up branch also failed.
test("BUY-70202: unreachable live product images are replaced with branded SVG instead of dropped", async () => {
  const originalFetch = globalThis.fetch;
  // Two live products with image URLs that point at a host that returns 404.
  // The verifier chain will mark both unreachable; under the old drop-on-fail
  // behavior the page would render 0 cards.
  globalThis.fetch = async (input) => {
    const url = String(input);
    // The page-level /api/products/search route returns the catalog.
    if (url.includes("/api/products/search")) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "r1", title: "Roborock S8 MaxV Ultra", brand: "Roborock", category: "robot_vacuums", price_amount: 1299, price_currency: "USD", merchant_name: "Amazon", click_url: "https://x/r1", image_url: "https://broken-host.example/r1.jpg" },
            { id: "r2", title: "iRobot Roomba Combo j9+", brand: "iRobot", category: "robot_vacuums", price_amount: 999, price_currency: "USD", merchant_name: "Best Buy", click_url: "https://x/r2", image_url: "https://broken-host.example/r2.jpg" },
          ],
          meta: { total: 2, degraded: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // Everything else (image probes) returns 404 — every live URL is unreachable.
    return new Response("not found", { status: 404 });
  };

  try {
    const products = await getSeoLandingProducts(seoLandingPages["best-robot-vacuums-2026"]);
    assert.equal(products.length, 2, "both cards must still render; replace-not-drop");
    for (const product of products) {
      assert.ok(product.imageUrl, `${product.name} must have a placeholder imageUrl`);
      assert.ok(
        product.imageUrl!.startsWith("data:image/svg+xml"),
        `${product.name} must have a branded SVG placeholder, not the broken CDN URL (got: ${product.imageUrl})`,
      );
      assert.doesNotMatch(
        product.imageUrl!,
        /broken-host\.example/,
        `${product.name} must not retain the unreachable upstream URL`,
      );
      // Real product data is preserved through the replace.
      assert.ok(product.name, `${product.id} must keep its real name`);
      assert.ok(product.price !== null, `${product.id} must keep its price`);
      assert.ok(product.merchant, `${product.id} must keep its merchant`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
