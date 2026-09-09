// BUY-75417 evidence — render ProductGridCard + USProductSsrPriceTable to a
// string with mocked data and grep for /r/ anchors. Proves the SSR HTML now
// carries <a href="/r/..." rel="nofollow sponsored"> that AI crawlers can
// crawl, even without JS.

// shim React globals — the components reference `React.memo` / `React.*`
// directly without `import React` (works in Next's compiler, not in raw tsx).
// eslint-disable-next-line @typescript-eslint/no-var-requires
import React from "react";
(globalThis as { React?: typeof React }).React = React;

import { renderToStaticMarkup } from "react-dom/server";
import { ProductGridCard } from "../../src/components/seo/ProductGridCard";
import USProductSsrPriceTable from "../../src/components/seo/USProductSsrPriceTable";
import type { LandingProduct } from "../../src/lib/seo-landing-pages";
import type { USProductOfferApiItem } from "../../src/lib/us-products";

function assertContains(label: string, html: string, needle: string, expected = true) {
  const found = html.includes(needle);
  const ok = expected ? found : !found;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${needle.slice(0, 80)}`);
  if (!ok) {
    console.log(`  full html (first 1200):\n${html.slice(0, 1200)}`);
    process.exitCode = 1;
  }
}

const product: LandingProduct = {
  id: "54614597",
  name: "Microsoft Surface Laptop 13-inch",
  price: 1299,
  currency: "SGD",
  merchant: "Shopee Singapore",
  merchantSlug: "shopee_sg",
  imageUrl: null,
  href: "https://buywhere.ai/r/direct/54614597?source=product_card",
  productUrl: "/products/sg/microsoft-surface-laptop-13/lp1",
  brand: "Microsoft",
  category: "laptops",
  countryCode: "SG",
  updatedAt: "2026-08-26T00:00:00Z",
};

const cardHtml = renderToStaticMarkup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ProductGridCard({ product, compact: false }) as any,
);

console.log("\n=== ProductGridCard SSR HTML ===\n");
console.log(cardHtml);
console.log("\n=== Greps ===\n");

assertContains(
  "ProductGridCard: contains /r/ anchor",
  cardHtml,
  'href="/r/direct/54614597?source=product_card"',
);
assertContains(
  "ProductGridCard: contains rel=nofollow sponsored",
  cardHtml,
  'rel="nofollow sponsored noopener noreferrer"',
);
assertContains(
  "ProductGridCard: contains Buy at <merchant> label",
  cardHtml,
  "Buy at Shopee Singapore",
);
assertContains(
  "ProductGridCard: contains data-affiliate-redirect marker",
  cardHtml,
  'data-affiliate-redirect="intent-product-card"',
);
assertContains(
  "ProductGridCard: NO <span role=button>",
  cardHtml,
  'role="button"',
  false,
);

// USProductSsrPriceTable
const usMatches: USProductOfferApiItem[] = [
  {
    id: "54437835",
    name: "HP 16.0 Laptop",
    merchant: "Newegg",
    merchant_name: "Newegg",
    price: 1299,
    currency: "USD",
    url: "https://buywhere.ai/r/direct/54437835?source=us_table",
    affiliate_redirect_url: "https://buywhere.ai/r/direct/54437835?source=us_table",
    affiliate_url: "https://buywhere.ai/r/direct/54437835?source=us_table",
    in_stock: true,
    source: "newegg_us",
  } as unknown as USProductOfferApiItem,
  {
    id: "54437836",
    name: "Asus ROG Zephyrus G16",
    merchant: "Best Buy",
    merchant_name: "Best Buy",
    price: 1499,
    currency: "USD",
    url: "https://www.bestbuy.com/site/asus-rog/12345.p",
    in_stock: true,
    source: "bestbuy_us",
  } as unknown as USProductOfferApiItem,
];

const usHtml = renderToStaticMarkup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  USProductSsrPriceTable({
    productId: "54437835",
    productName: "HP 16.0 Laptop",
    pagePath: "/products/us/hp-16-0-laptop",
    description: "Compare current retailer pricing for HP 16.0 Laptop.",
    matches: usMatches,
    sku: "SKU-54437835",
    category: "laptops",
  }) as any,
);

console.log("\n=== USProductSsrPriceTable SSR HTML ===\n");
console.log(usHtml);
console.log("\n=== Greps ===\n");

assertContains(
  "US table: contains /r/ anchor (already-buywhere URL row)",
  usHtml,
  'href="/r/direct/54437835?source=us_table"',
);
assertContains(
  "US table: contains fallback /r/direct/{id} anchor for raw merchant row",
  usHtml,
  'href="/r/direct/54437835?source=us_table"',
);
assertContains(
  "US table: contains rel=nofollow sponsored",
  usHtml,
  'rel="nofollow sponsored noopener noreferrer"',
);

console.log("\nDone.");