import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductSchema,
  buildBreadcrumbSchema,
  buildItemListSchema,
  buildFaqPageSchema,
  buildProductDetailGraph,
} from "@/lib/product-schema";

type SchemaNode = Record<string, unknown>;

// BUY-69663 — AEO integrity contract for product-cluster JSON-LD:
// real data only, no undefined leakage, absolute URLs, one publisher @id.

test("Product omits aggregateRating when no rating is passed", () => {
  const schema = buildProductSchema({
    path: "/products/us/acme/123/",
    name: "Test Widget",
    offer: { price: 19.99, priceCurrency: "USD", sellerName: "Acme" },
  });
  const json = JSON.stringify(schema);
  assert.equal(json.includes("aggregateRating"), false);
  assert.equal(json.includes("undefined"), false);
  assert.equal(schema["@id"], "https://buywhere.ai/products/us/acme/123#product");
});

test("Product emits aggregateRating only for real rating data", () => {
  const withRating = buildProductSchema({
    path: "/products/us/acme/123/",
    name: "Test Widget",
    rating: { ratingValue: 4.6, reviewCount: 212 },
  });
  assert.equal(withRating.aggregateRating!.ratingValue, 4.6);
  assert.equal(withRating.aggregateRating!.reviewCount, 212);
  assert.equal(withRating.aggregateRating!.bestRating, 5);
});

test("Product rejects zero-review rating (would be fabricated)", () => {
  const schema = buildProductSchema({
    path: "/products/us/acme/123/",
    name: "Test Widget",
    rating: { ratingValue: 4.6, reviewCount: 0 },
  });
  assert.equal(
    JSON.stringify(schema).includes("aggregateRating"),
    false,
  );
});

test("Breadcrumb renders ordered absolute-URL ListItems", () => {
  const schema = buildBreadcrumbSchema("/products/us/acme/123/", [
    { name: "Home", path: "/" },
    { name: "Acme", path: "/us/acme/products/" },
    { name: "Test Widget", path: "/products/us/acme/123/" },
  ]);
  assert.equal(schema.itemListElement.length, 3);
  assert.deepEqual(
    schema.itemListElement.map((c: { position: number }) => c.position),
    [1, 2, 3],
  );
  assert.equal(
    schema.itemListElement[0].item,
    "https://buywhere.ai/",
  );
});

test("ItemList enumerates cluster products with positions", () => {
  const schema = buildItemListSchema("/best-widgets-us", [
    { name: "A", path: "/products/us/acme/1/" },
    { name: "B", path: "/products/us/acme/2/" },
  ]);
  assert.equal(schema.itemListElement[1].url, "https://buywhere.ai/products/us/acme/2");
  assert.equal(schema.itemListElement[1].position, 2);
});

test("FAQPage maps Buzz copy to Question/Answer pairs", () => {
  const schema = buildFaqPageSchema("/best-widgets-us", [
    { question: "Where is it cheapest?", answer: "Acme at $19.99." },
  ]);
  assert.equal(schema.mainEntity[0]["@type"], "Question");
  assert.equal(schema.mainEntity[0].acceptedAnswer.text, "Acme at $19.99.");
});

test("Product detail graph anchors publisher and omits empty sections", () => {
  const graph = buildProductDetailGraph({
    product: {
      path: "/products/us/acme/123/",
      name: "Test Widget",
      description: "A widget",
      offer: { price: 19.99, priceCurrency: "USD" },
    },
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Test Widget", path: "/products/us/acme/123/" },
    ],
  });
  const nodes = graph["@graph"] as SchemaNode[];
  const types = nodes.map((n) => n["@type"]);
  assert.deepEqual(types, ["WebPage", "BreadcrumbList", "Product"]);
  const webpage = nodes[0];
  assert.equal(webpage.publisher["@id"], "https://buywhere.ai/#organization");
  assert.equal(webpage.isPartOf["@id"], "https://buywhere.ai/#website");
  assert.equal(JSON.stringify(graph).includes("undefined"), false);
});

test("Product detail graph includes FAQ and ItemList when supplied", () => {
  const graph = buildProductDetailGraph({
    product: { path: "/best-widgets-us", name: "Best Widgets" },
    breadcrumb: [{ name: "Home", path: "/" }],
    faq: [{ question: "Q?", answer: "A." }],
    itemList: [{ name: "Widget", path: "/products/us/acme/1/" }],
  });
  const types = (graph["@graph"] as SchemaNode[]).map((n) => n["@type"]);
  assert.ok(types.includes("FAQPage"));
  assert.ok(types.includes("ItemList"));
});

test("optional product fields are absent, not null, when missing", () => {
  const schema = buildProductSchema({
    path: "/products/sg/shop/9/",
    name: "Minimal",
  });
  assert.equal("brand" in schema, false);
  assert.equal("sku" in schema, false);
  assert.equal("offers" in schema, false);
  assert.equal("image" in schema, false);
});

test("AggregateOffer summarizes multi-merchant pricing with sellers", () => {
  const schema = buildProductSchema({
    path: "/products/us/acme/123/",
    name: "Test Widget",
    aggregateOffer: {
      lowPrice: 18.5,
      highPrice: 24.0,
      priceCurrency: "USD",
      offerCount: 3,
      sellers: ["Acme", "Beta", "Gamma"],
    },
  });
  const offers = schema.offers as SchemaNode;
  assert.equal(offers["@type"], "AggregateOffer");
  assert.equal(offers.offerCount, 3);
  assert.equal(offers.sellers.length, 3);
});
