import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProductSlug,
  pickLegacyProductHit,
  slugToSearchQuery,
} from "./legacy-product-slug";

describe("BUY-82755 legacy /product/<slug> lookup", () => {
  const raw =
    "Gigabyte-Gaming-A16-GA63TH-RTX-5050-Laptop-AMD-Ryzen-7-260-16GB-DDR5-16-Inch-165Hz-IPS-WUX";

  it("normalizes mixed-case title slugs the same way ingest does", () => {
    assert.equal(
      normalizeProductSlug(raw),
      "gigabyte-gaming-a16-ga63th-rtx-5050-laptop-amd-ryzen-7-260-16gb-ddr5-16-inch-165hz-ips-wux",
    );
  });

  it("turns the slug into a searchable query", () => {
    assert.match(slugToSearchQuery(raw), /gigabyte gaming a16/);
  });

  it("matches a truncated incoming slug to the full title slug", () => {
    const hit = pickLegacyProductHit(raw, [
      {
        id: "871873063695734596",
        name: "Gigabyte Gaming A16 GA63TH RTX 5050 Laptop AMD Ryzen 7 260 16GB DDR5 16 Inch 165Hz IPS WUXGA Gaming Laptop",
        merchant: "compumarts.com",
      },
    ]);
    assert.ok(hit);
    assert.equal(hit.id, "871873063695734596");
  });

  it("returns null for unknown slugs with no unique fuzzy match", () => {
    const hit = pickLegacyProductHit("this-product-does-not-exist-zzzz", [
      { id: "1", name: "Sony WH-1000XM5" },
      { id: "2", name: "Apple MacBook Air" },
    ]);
    assert.equal(hit, null);
  });

  it("returns the single search result as a fuzzy fallback", () => {
    const hit = pickLegacyProductHit("gigabyte-gaming-a16", [
      {
        id: "871873063695734596",
        name: "Gigabyte Gaming A16 GA63TH RTX 5050 Laptop AMD Ryzen 7 260 16GB DDR5 16 Inch 165Hz IPS WUXGA Gaming Laptop",
      },
    ]);
    assert.ok(hit);
    assert.equal(hit.id, "871873063695734596");
  });

  it("prefers the longest prefix-matching title when several A16 SKUs return", () => {
    const hit = pickLegacyProductHit(raw, [
      { id: "1", name: "Gigabyte Gaming A16 16.0 165Hz 1TB 16GB DDR5 RTX 5050 Windows Laptop" },
      {
        id: "871873063695734596",
        name: "Gigabyte Gaming A16 GA63TH RTX 5050 Laptop AMD Ryzen 7 260 16GB DDR5 16 Inch 165Hz IPS WUXGA Gaming Laptop",
      },
    ]);
    assert.ok(hit);
    assert.equal(hit.id, "871873063695734596");
  });
});
