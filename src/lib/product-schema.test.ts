import assert from "node:assert/strict";
import test from "node:test";
import {
  ORGANIZATION_ID,
  WEBSITE_ID,
} from "@/lib/page-schema";
import {
  buildBreadcrumbListSchema,
  buildFAQPageSchema,
  buildItemListSchema,
  buildProductSchema,
} from "@/lib/product-schema";

test("buildBreadcrumbListSchema emits ordered canonical breadcrumb list items", () => {
  const schema = buildBreadcrumbListSchema({
    path: "/best/laptops",
    items: [
      { name: "Home", path: "/" },
      { name: "Best", path: "/best" },
      { name: "Laptops", path: "/best/laptops" },
    ],
  });

  assert.equal(schema["@context"], "https://schema.org");
  assert.equal(schema["@type"], "BreadcrumbList");
  assert.equal(schema["@id"], "https://buywhere.ai/best/laptops#breadcrumb");
  assert.deepEqual(schema.itemListElement.map((item) => item.position), [1, 2, 3]);
  assert.equal(schema.itemListElement[0].item, "https://buywhere.ai/");
  assert.equal(schema.itemListElement[2].item, "https://buywhere.ai/best/laptops");
});

test("buildItemListSchema includes organization attribution and nested Product offers", () => {
  const schema = buildItemListSchema({
    path: "/laptop-singapore",
    name: "Best Laptops in Singapore",
    description: "Compare laptops across Singapore retailers.",
    numberOfItems: 45_000,
    items: [
      {
        id: "macbook-air-m3",
        name: "MacBook Air M3",
        description: "Apple laptop for students and commuters.",
        url: "https://buywhere.ai/products/sg/apple/macbook-air-m3",
        image: "https://cdn.example/macbook.jpg",
        price: 1299,
        priceCurrency: "SGD",
        brand: "Apple",
        sku: "MBA-M3",
      },
    ],
  });

  const graph = schema["@graph"] as Array<Record<string, any>>;
  assert.equal(schema["@context"], "https://schema.org");
  assert.ok(graph.some((node) => node["@id"] === ORGANIZATION_ID));
  assert.ok(graph.some((node) => node["@id"] === WEBSITE_ID));

  const collection = graph.find((node) => node["@type"] === "CollectionPage")!;
  assert.equal(collection.publisher, undefined);
  assert.deepEqual(collection.isPartOf, { "@id": WEBSITE_ID });
  assert.deepEqual(collection.about, { "@id": ORGANIZATION_ID });

  const itemList = graph.find((node) => node["@type"] === "ItemList")!;
  assert.equal(itemList.numberOfItems, 45_000);
  assert.equal(itemList.itemListElement[0]["@type"], "ListItem");
  assert.equal(itemList.itemListElement[0].item["@type"], "Product");
  assert.equal(itemList.itemListElement[0].item.brand.name, "Apple");
  assert.equal(itemList.itemListElement[0].item.offers.priceCurrency, "SGD");
});

test("buildFAQPageSchema emits FAQPage questions under a graph with BuyWhere attribution", () => {
  const schema = buildFAQPageSchema({
    path: "/best/air-purifiers",
    name: "Air purifier FAQ",
    description: "Common buying questions for air purifiers.",
    questions: [
      {
        "@type": "Question",
        name: "What should I compare before buying an air purifier?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Compare room coverage, filter cost, noise, warranty, and live merchant pricing.",
        },
      },
    ],
  });

  const graph = schema["@graph"] as Array<Record<string, any>>;
  const faq = graph.find((node) => node["@type"] === "FAQPage")!;
  assert.equal(faq["@id"], "https://buywhere.ai/best/air-purifiers#faq");
  assert.equal(faq.mainEntity[0]["@type"], "Question");
  assert.equal(faq.mainEntity[0].acceptedAnswer["@type"], "Answer");
  assert.ok(graph.some((node) => node["@id"] === ORGANIZATION_ID));
});

test("buildProductSchema supports optional Offer, AggregateRating, and Review data without inventing them", () => {
  const schema = buildProductSchema({
    path: "/products/sg/dyson/purifier-cool-gen1",
    name: "Dyson Purifier Cool Gen1",
    description: "Compare Dyson Purifier Cool Gen1 offers in Singapore.",
    sku: "419865-01",
    brand: "Dyson",
    category: "Air Purifiers",
    countryOfOrigin: "Singapore",
    images: [{ url: "https://cdn.example/dyson.png", width: 800, height: 800 }],
    offers: [{ price: 699, priceCurrency: "SGD", merchantName: "Dyson Singapore" }],
    aggregateRating: { ratingValue: 4.6, reviewCount: 128 },
    reviews: [
      {
        author: "BuyWhere editorial",
        datePublished: "2026-08-14",
        reviewBody: "Strong premium purifier option for Singapore homes.",
        reviewRating: { ratingValue: 4.5, reviewCount: 1 },
      },
    ],
  });

  const graph = schema["@graph"] as Array<Record<string, any>>;
  const product = graph.find((node) => node["@type"] === "Product")!;
  assert.equal(product["@id"], "https://buywhere.ai/products/sg/dyson/purifier-cool-gen1#product");
  assert.equal(product.brand.name, "Dyson");
  assert.equal(product.offers[0].seller.name, "Dyson Singapore");
  assert.equal(product.aggregateRating.reviewCount, 128);
  assert.equal(product.review[0].author.name, "BuyWhere editorial");

  const withoutOptional = buildProductSchema({
    path: "/products/sg/example/1",
    name: "Example Product",
    description: "No fabricated ratings or reviews.",
  });
  const optionalProduct = (withoutOptional["@graph"] as Array<Record<string, any>>).find(
    (node) => node["@type"] === "Product",
  )!;
  assert.equal("aggregateRating" in optionalProduct, false);
  assert.equal("review" in optionalProduct, false);
  assert.equal("offers" in optionalProduct, false);
});
