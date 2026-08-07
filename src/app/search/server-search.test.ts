import assert from "node:assert/strict";
import test from "node:test";
import { loadInitialSearchResults } from "@/app/search/server-search";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.BUYWHERE_API_KEY;
const originalApiUrl = process.env.NEXT_PUBLIC_BUYWHERE_API_URL;

function restoreEnv() {
  if (originalApiKey === undefined) delete process.env.BUYWHERE_API_KEY;
  else process.env.BUYWHERE_API_KEY = originalApiKey;
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_BUYWHERE_API_URL;
  else process.env.NEXT_PUBLIC_BUYWHERE_API_URL = originalApiUrl;
  globalThis.fetch = originalFetch;
}

test("loadInitialSearchResults normalizes upstream items for SSR", async () => {
  process.env.BUYWHERE_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL = "https://api.test.buywhere.ai";

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    assert.match(url, /\/v1\/products\/search\?/);
    assert.ok(url.includes("q=gaming%20laptop"));
    assert.ok(url.includes("country_code=US"));
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "54452825",
            title: "GIGABYTE GAMING A16 Gaming Laptop",
            price: { amount: 1349.99, currency: "USD" },
            merchant_name: "newegg_us",
            affiliate_redirect_url: "https://api.buywhere.ai/r/direct/54452825",
            image_url: "https://c1.neweggimages.com/ProductImageCompressAll1280/34-233-624-02.jpg",
            metadata: { brand: "GIGABYTE", category: "Laptops" },
          },
          {
            id: "54412203",
            title: "Seagate SSD",
            price: { amount: 229, currency: "USD" },
            merchant_name: "newegg_us",
            affiliate_redirect_url: "https://api.buywhere.ai/r/direct/54412203",
            image_url: "https://example.com/missing-image-placeholder.jpg",
            metadata: { brand: "Seagate", category: "Storage" },
          },
        ],
        meta: { total: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await loadInitialSearchResults({
      query: "gaming laptop",
      countryCode: "us",
      fallbackCurrency: "USD",
    });
    assert.equal(result.products.length, 2);
    assert.equal(result.products[0].name, "GIGABYTE GAMING A16 Gaming Laptop");
    assert.equal(result.products[0].price, 1349.99);
    assert.equal(result.products[0].merchant, "Newegg Us");
    assert.equal(result.products[1].imageUrl, null);
    assert.equal(result.total, 2);
  } finally {
    restoreEnv();
  }
});

test("loadInitialSearchResults returns empty when query is too short", async () => {
  const result = await loadInitialSearchResults({
    query: "a",
    countryCode: "us",
    fallbackCurrency: "USD",
  });
  assert.deepEqual(result, { products: [], total: 0, degraded: false, hint: null });
});

test("loadInitialSearchResults swallows upstream 5xx so SSR still renders", async () => {
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL = "https://api.test.buywhere.ai";
  globalThis.fetch = async () =>
    new Response("upstream down", { status: 502, headers: { "content-type": "text/plain" } });

  try {
    const result = await loadInitialSearchResults({
      query: "gaming laptop",
      countryCode: "us",
      fallbackCurrency: "USD",
    });
    assert.deepEqual(result, { products: [], total: 0, degraded: false, hint: null });
  } finally {
    restoreEnv();
  }
});
