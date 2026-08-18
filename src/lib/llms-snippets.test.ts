import assert from "node:assert/strict";
import test from "node:test";
import {
  renderProductLlmsSnippet,
  renderCategoryLlmsSnippet,
} from "@/lib/llms-snippets";

// BUY-70312 — llms.txt snippet contract:
//   * plain text, human-readable (same convention as site-level llms.txt)
//   * price renders "amount currency" or "<min>-<max> currency"
//   * availability is a resolved label, not raw shipping text
//   * brand is empty string when unbranded (never "unknown")
//   * NO bw_live_* API keys (AC #8) — only the placeholder in the auth hint

test("Product snippet matches the BUY-70312 format spec", () => {
  const snippet = renderProductLlmsSnippet({
    country: "us",
    productId: "1152920887995236468",
    title: "Broadcloth Long Sleeve Shirt",
    description: "A classic broadcloth shirt in preshrunk cotton.",
    currency: "USD",
    price: 39.9,
    availability: "local",
    brand: "Uniqlo",
    category: "fashion",
    merchantSlug: "uniqlo",
    merchantName: "Uniqlo",
    url: "https://buywhere.ai/products/us/uniqlo/1152920887995236468/",
    imageUrl: "https://example.com/img.jpg",
  });

  const lines = snippet.split("\n");
  assert.equal(lines[0], "# Broadcloth Long Sleeve Shirt");
  assert.ok(lines[1].startsWith("> "));
  assert.ok(lines[1].length <= 203); // "> " + 200 chars + possible ellipsis

  assert.ok(snippet.includes("## Product"));
  assert.ok(snippet.includes("name: Broadcloth Long Sleeve Shirt"));
  assert.ok(snippet.includes("id: 1152920887995236468"));
  assert.ok(snippet.includes("country: US"));
  assert.ok(snippet.includes("currency: USD"));
  assert.ok(snippet.includes("price: 39.90 USD"));
  assert.ok(snippet.includes("availability: local"));
  assert.ok(snippet.includes("brand: Uniqlo"));
  assert.ok(snippet.includes("category: fashion"));
  assert.ok(snippet.includes("merchant: uniqlo"));
  assert.ok(
    snippet.includes(
      "url: https://buywhere.ai/products/us/uniqlo/1152920887995236468/",
    ),
  );
  assert.ok(snippet.includes("image: https://example.com/img.jpg"));

  assert.ok(snippet.includes("## How to fetch via MCP"));
  assert.ok(
    snippet.includes("tool: search_products (q=Broadcloth Long Sleeve Shirt)"),
  );
  assert.ok(
    snippet.includes("tool: get_product (product_id=1152920887995236468)"),
  );
  assert.ok(
    snippet.includes(
      "tool: compare_products (ids=1152920887995236468)",
    ),
  );
  assert.ok(snippet.includes("endpoint: https://api.buywhere.ai/mcp"));

  assert.ok(snippet.includes("## How to fetch via REST"));
  assert.ok(
    snippet.includes(
      "endpoint: GET https://api.buywhere.ai/v1/products/1152920887995236468",
    ),
  );
  assert.ok(snippet.includes("&deliver_to=US"));
  assert.ok(snippet.includes("auth: Bearer bw_live_<key>"));
});

test("Product snippet renders a range for multi-merchant snapshots", () => {
  const snippet = renderProductLlmsSnippet({
    country: "sg",
    productId: "42",
    title: "Test Camera",
    currency: "SGD",
    minPrice: 10,
    maxPrice: 20,
    availability: "local",
    url: "https://buywhere.ai/products/sg/p/42/",
  });
  assert.ok(snippet.includes("price: 10.00-20.00 SGD"));
});

test("Product snippet renders no price line when unpriced", () => {
  const snippet = renderProductLlmsSnippet({
    country: "sg",
    availability: "unknown",
    currency: "SGD",
    productId: "42",
    title: "Test Camera",
    url: "https://buywhere.ai/products/sg/p/42/",
  });
  assert.ok(!/^price:/m.test(snippet));
  assert.ok(snippet.includes("availability: unknown"));
});

test("Product snippet brand is empty string when unbranded", () => {
  const snippet = renderProductLlmsSnippet({
    country: "us",
    availability: "local",
    currency: "USD",
    productId: "1",
    title: "Generic Gadget",
    brand: null,
    url: "https://buywhere.ai/products/us/p/1/",
  });
  assert.ok(snippet.includes("brand: "));
  assert.ok(!snippet.includes("brand: unknown"));
  assert.ok(!snippet.includes("brand: null"));
  assert.ok(!snippet.includes("brand: undefined"));
});

test("Product snippet never leaks a real API key (AC #8)", () => {
  const snippet = renderProductLlmsSnippet({
    country: "us",
    availability: "local",
    currency: "USD",
    productId: "1",
    title: "Generic Gadget",
    url: "https://buywhere.ai/products/us/p/1/",
  });
  // Only the literal placeholder `<key>` may appear next to bw_live_.
  const hits = snippet.match(/bw_live_[^\s]*/g) ?? [];
  assert.deepEqual(hits, ["bw_live_<key>"]);
});

test("Product snippet truncates description at 200 chars", () => {
  const snippet = renderProductLlmsSnippet({
    country: "us",
    availability: "local",
    currency: "USD",
    productId: "1",
    title: "T",
    description: "x".repeat(300),
    url: "https://buywhere.ai/products/us/p/1/",
  });
  const descLine = snippet.split("\n").find((l) => l.startsWith("> "))!;
  assert.ok(descLine.length <= 203);
  assert.ok(descLine.endsWith("..."));
});

test("Category snippet matches the BUY-70312 format spec", () => {
  const snippet = renderCategoryLlmsSnippet({
    country: "sg",
    slug: "electronics",
    name: "Electronics",
    description: "Compare electronics products and prices available in Singapore.",
    productCount: 12345,
    sampleQueries: ["Electronics", "best electronics", "cheapest electronics"],
    url: "https://buywhere.ai/categories/electronics/sg",
  });

  assert.ok(snippet.startsWith("# Electronics"));
  assert.ok(snippet.includes("## Category"));
  assert.ok(snippet.includes("slug: electronics"));
  assert.ok(snippet.includes("country: SG"));
  assert.ok(snippet.includes("products: 12,345"));
  assert.ok(snippet.includes('sample_queries:\n  - "Electronics"\n  - "best electronics"\n  - "cheapest electronics"'));

  assert.ok(snippet.includes("## How to fetch via MCP"));
  assert.ok(snippet.includes("tool: list_categories"));
  assert.ok(snippet.includes("tool: search_products (q=<query>, category=electronics)"));

  assert.ok(snippet.includes("## How to fetch via REST"));
  assert.ok(
    snippet.includes("endpoint: GET https://api.buywhere.ai/v1/categories/electronics"),
  );
  assert.ok(snippet.includes("category=electronics&deliver_to=SG"));
});

test("Category snippet caps sample_queries at 3", () => {
  const snippet = renderCategoryLlmsSnippet({
    country: "us",
    slug: "fashion",
    name: "Fashion",
    sampleQueries: ["a", "b", "c", "d", "e"],
    url: "https://buywhere.ai/categories/fashion/us",
  });
  const queryLines = snippet.split("\n").filter((l) => l.trim().startsWith('- "'));
  assert.equal(queryLines.length, 3);
});

test("Category snippet omits count when unknown", () => {
  const snippet = renderCategoryLlmsSnippet({
    country: "us",
    slug: "fashion",
    name: "Fashion",
    url: "https://buywhere.ai/categories/fashion/us",
  });
  assert.ok(!/^products:/m.test(snippet));
});
