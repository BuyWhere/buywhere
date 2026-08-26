import { describe, it, expect } from "vitest";
import { isMerchantAllowedForCountry, filterProductsForCountry } from "./merchant-allowlist";

describe("isMerchantAllowedForCountry (slug-based, for search API items)", () => {
  it("allows exact slug match", () => {
    expect(isMerchantAllowedForCountry({ merchant: "apple_sg" }, "SG")).toBe(true);
    expect(isMerchantAllowedForCountry({ merchant: "apple_us" }, "US")).toBe(true);
    expect(isMerchantAllowedForCountry({ merchant: "amazon_sg" }, "SG")).toBe(true);
  });

  it("allows provider-suffixed slugs (BUY-75412 prefix match)", () => {
    expect(isMerchantAllowedForCountry({ merchant: "apple_sg_buy_xml" }, "SG")).toBe(true);
    expect(isMerchantAllowedForCountry({ merchant: "harvey_norman_sg_buy_xml" }, "SG")).toBe(true);
    expect(isMerchantAllowedForCountry({ merchant: "amazon_us_buy_xml" }, "US")).toBe(true);
    expect(isMerchantAllowedForCountry({ merchant: "bestbuy_feed" }, "US")).toBe(true);
  });

  it("rejects false-prefix slugs", () => {
    expect(isMerchantAllowedForCountry({ merchant: "apples_sg" }, "SG")).toBe(false);
    expect(isMerchantAllowedForCountry({ merchant: "amazons_sg" }, "SG")).toBe(false);
  });

  it("rejects unknown merchants", () => {
    expect(isMerchantAllowedForCountry({ merchant: "compumarts" }, "SG")).toBe(false);
    expect(isMerchantAllowedForCountry({ merchant: "random_store" }, "US")).toBe(false);
  });

  it("returns false for missing merchant", () => {
    expect(isMerchantAllowedForCountry({}, "SG")).toBe(false);
    expect(isMerchantAllowedForCountry({ merchant: null }, "US")).toBe(false);
  });

  it("returns false for unsupported country", () => {
    expect(isMerchantAllowedForCountry({ merchant: "apple" }, "JP" as any)).toBe(false);
  });

  it("falls back to source field when merchant is absent", () => {
    expect(isMerchantAllowedForCountry({ source: "apple_sg" }, "SG")).toBe(true);
    expect(isMerchantAllowedForCountry({ source: "apple_sg_buy_xml" }, "SG")).toBe(true);
  });
});

describe("filterProductsForCountry (label-based, for curated fallbacks)", () => {
  it("keeps allowed label matches and drops unknowns", () => {
    const products = [
      { merchant: "Apple" },
      { merchant: "Samsung" },
      { merchant: "RandomStore" },
    ];
    const filtered = filterProductsForCountry(products, "SG");
    expect(filtered.map((p) => p.merchant)).toEqual(["Apple", "Samsung"]);
  });
});
