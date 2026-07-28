import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  getSeoLandingProducts,
  isCompleteRobotVacuum,
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
