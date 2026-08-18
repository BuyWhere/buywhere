// Product-cluster JSON-LD builders for BUY-69663.
//
// Shared builders for the wave-1 product-detail landing pages (~45k) so every
// page emits a coherent @graph instead of per-page inline blocks: Product,
// Offer/AggregateOffer, ItemList, FAQPage, BreadcrumbList, anchored to the
// site-wide Organization/WebSite nodes from page-schema.ts.
//
// AEO integrity rules (enforced by tests in product-schema.test.ts):
//   * AggregateRating is emitted ONLY when the caller passes real rating data
//     sourced from merchant feeds. Never synthesized, never defaulted —
//     fabricated ratings are a rich-result manual-action risk (BUY-69663).
//   * No `undefined` leaks into the serialized JSON: optional fields are
//     spread conditionally and absent data simply omits the property.
//   * Every URL is absolute under https://buywhere.ai via toSiteUrl.

import { toSiteUrl } from "@/lib/site-url";
import { ORGANIZATION_ID, WEBSITE_ID } from "@/lib/page-schema";

export type ProductRating = {
  /** e.g. 4.6 — must come from a real rating source, never a constant. */
  ratingValue: number;
  /** Number of real reviews backing ratingValue. */
  reviewCount: number;
  bestRating?: number;
};

export type OfferInput = {
  price: number;
  priceCurrency: string;
  /** Merchant display name for the seller node. */
  sellerName?: string;
  /** Product URL on the merchant's site, when known. */
  url?: string | null;
  availability?: string;
};

export type ProductInput = {
  /** Stable page anchor, e.g. /products/us/acme/12345/ */
  path: string;
  name: string;
  description?: string | null;
  image?: string | null;
  brand?: string | null;
  category?: string | null;
  /** SKU/GTIN when anchored; omit otherwise. */
  sku?: string | null;
  gtin13?: string | null;
  /** Real rating data only — see integrity rules above. */
  rating?: ProductRating | null;
  /** Single-merchant offer. */
  offer?: OfferInput | null;
  /** Multi-merchant offer summary. */
  aggregateOffer?: AggregateOfferInput | null;
};

export type AggregateOfferInput = {
  lowPrice: number;
  highPrice?: number | null;
  priceCurrency: string;
  offerCount: number;
  sellers?: string[];
  availability?: string;
};

export type FaqEntry = {
  question: string;
  answer: string;
};

export type BreadcrumbInput = {
  name: string;
  path: string;
};

export const IN_STOCK = "https://schema.org/InStock";

function buildOffer(offer: OfferInput) {
  return {
    "@type": "Offer",
    price: offer.price,
    priceCurrency: offer.priceCurrency,
    availability: offer.availability ?? IN_STOCK,
    ...(offer.url ? { url: offer.url } : {}),
    ...(offer.sellerName
      ? { seller: { "@type": "Organization", name: offer.sellerName } }
      : {}),
  };
}

export function buildAggregateOfferSchema(input: AggregateOfferInput) {
  return {
    "@type": "AggregateOffer",
    lowPrice: input.lowPrice,
    ...(input.highPrice != null ? { highPrice: input.highPrice } : {}),
    priceCurrency: input.priceCurrency,
    offerCount: input.offerCount,
    availability: input.availability ?? IN_STOCK,
    ...(input.sellers && input.sellers.length > 0
      ? {
          sellers: input.sellers.map((name) => ({
            "@type": "Organization",
            name,
          })),
        }
      : {}),
  };
}

export function buildProductSchema(input: ProductInput) {
  const url = toSiteUrl(input.path);
  return {
    "@type": "Product",
    "@id": `${url}#product`,
    url,
    name: input.name,
    ...(input.description
      ? { description: input.description }
      : {}),
    ...(input.image ? { image: input.image } : {}),
    ...(input.brand ? { brand: { "@type": "Brand", name: input.brand } } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.sku ? { sku: input.sku } : {}),
    ...(input.gtin13 ? { gtin13: input.gtin13 } : {}),
    // Real ratings only. Callers must not pass constants — see integrity rules.
    ...(input.rating &&
    Number.isFinite(input.rating.ratingValue) &&
    input.rating.reviewCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: input.rating.ratingValue,
            reviewCount: input.rating.reviewCount,
            bestRating: input.rating.bestRating ?? 5,
          },
        }
      : {}),
    ...(input.offer ? { offers: buildOffer(input.offer) } : {}),
    ...(input.aggregateOffer
      ? { offers: buildAggregateOfferSchema(input.aggregateOffer) }
      : {}),
  };
}

export function buildBreadcrumbSchema(path: string, crumbs: BreadcrumbInput[]) {
  const url = toSiteUrl(path);
  return {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: toSiteUrl(crumb.path),
    })),
  };
}

export function buildItemListSchema(
  path: string,
  items: { name: string; path: string }[],
) {
  const url = toSiteUrl(path);
  return {
    "@type": "ItemList",
    "@id": `${url}#itemlist`,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: toSiteUrl(item.path),
      name: item.name,
    })),
  };
}

export function buildFaqPageSchema(path: string, entries: FaqEntry[]) {
  const url = toSiteUrl(path);
  return {
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: entry.answer,
      },
    })),
  };
}

export type ProductDetailGraphInput = {
  product: ProductInput;
  breadcrumb: BreadcrumbInput[];
  faq?: FaqEntry[];
  /** ItemList of sibling/cluster products rendered on the same page. */
  itemList?: { name: string; path: string }[];
};

/**
 * Full @graph for a product-detail landing page: Organization + WebSite are
 * referenced by @id (they live in the base graph), the page's own nodes are
 * BreadcrumbList + Product (+ FAQPage/ItemList when provided). Answer engines
 * resolve the whole graph, so every page links back to the publisher.
 */
export function buildProductDetailGraph(input: ProductDetailGraphInput) {
  const url = toSiteUrl(input.product.path);
  const graph: object[] = [
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: input.product.name,
      ...(input.product.description
        ? { description: input.product.description }
        : {}),
      isPartOf: { "@id": WEBSITE_ID },
      about: { "@id": `${url}#product` },
      publisher: { "@id": ORGANIZATION_ID },
    },
    buildBreadcrumbSchema(input.product.path, input.breadcrumb),
    buildProductSchema(input.product),
  ];
  if (input.itemList && input.itemList.length > 0) {
    graph.push(buildItemListSchema(input.product.path, input.itemList));
  }
  if (input.faq && input.faq.length > 0) {
    graph.push(buildFaqPageSchema(input.product.path, input.faq));
  }
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}
