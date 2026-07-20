import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getSeoLandingProducts, seoLandingPages } from "@/lib/seo-landing-pages";

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
