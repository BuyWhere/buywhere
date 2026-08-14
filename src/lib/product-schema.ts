// JSON-LD schema helpers for product-listing and product-detail pages.
// These complement src/lib/page-schema.ts which owns Organization/WebSite/WebPage/Service/CollectionPage.
// Consumers: src/app/[seo-page]/[merchant]/products/page.tsx and product-detail pages.

import { baseGraph, ORGANIZATION_ID, WEBSITE_ID } from "@/lib/page-schema";
import { toSiteUrl } from "@/lib/site-url";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const OFFER_ID_BASE = "https://buywhere.ai/#offer";

export const REVIEW_ID_BASE = "https://buywhere.ai/#review";

export const RATING_ID_BASE = "https://buywhere.ai/#rating";

// ---------------------------------------------------------------------------
// BreadcrumbList  (standalone — used on pages that already have a WebPage node
//                 in page-schema.ts but need an explicit breadcrumb entity)
// ---------------------------------------------------------------------------

export type BreadcrumbItem = {
  name: string;
  path: string;
};

export type BreadcrumbListInput = {
  path: string;          // canonical page path, e.g. "/products/sg/laptops"
  items: BreadcrumbItem[];
};

export function buildBreadcrumbListSchema(input: BreadcrumbListInput) {
  const url = toSiteUrl(input.path);
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: input.items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: toSiteUrl(item.path),
    })),
  };
}

// ---------------------------------------------------------------------------
// AggregateRating
// ---------------------------------------------------------------------------

export type AggregateRatingInput = {
  ratingValue: number;        // e.g. 4.5
  reviewCount: number;        // e.g. 128
  bestRating?: number;        // default 5
  worstRating?: number;       // default 1
};

export function buildAggregateRating(input: AggregateRatingInput) {
  return {
    "@type": "AggregateRating",
    ratingValue: input.ratingValue,
    reviewCount: input.reviewCount,
    bestRating: input.bestRating ?? 5,
    worstRating: input.worstRating ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Individual Review
// ---------------------------------------------------------------------------

export type ReviewInput = {
  author: string;
  datePublished: string;   // ISO-8601 date, e.g. "2026-01-15"
  reviewBody?: string;
  reviewRating: AggregateRatingInput;
};

export function buildReview(id: string, input: ReviewInput) {
  return {
    "@type": "Review",
    "@id": `${id}`,
    author: { "@type": "Person", name: input.author },
    datePublished: input.datePublished,
    ...(input.reviewBody ? { reviewBody: input.reviewBody } : {}),
    reviewRating: buildAggregateRating(input.reviewRating),
  };
}

// ---------------------------------------------------------------------------
// Offer
// ---------------------------------------------------------------------------

export type OfferInput = {
  price: number | string;
  priceCurrency: string;          // "USD" | "SGD" | …
  availability?: string;         // schema.org IRI, e.g. "https://schema.org/InStock"
  merchantName?: string;
  url?: string;                  // buy now URL
};

export function buildOffer(id: string, input: OfferInput) {
  return {
    "@type": "Offer",
    "@id": `${id}`,
    price: input.price,
    priceCurrency: input.priceCurrency,
    availability: input.availability ?? "https://schema.org/InStock",
    ...(input.merchantName
      ? { seller: { "@type": "Organization", name: input.merchantName } }
      : {}),
    ...(input.url ? { url: input.url } : {}),
  };
}

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export type ProductImage = {
  url: string;
  width?: number;
  height?: number;
};

export type ProductInput = {
  path: string;
  name: string;
  description: string;
  sku?: string;
  brand?: string;
  images?: ProductImage[];
  offers?: OfferInput[];
  aggregateRating?: AggregateRatingInput;
  reviews?: ReviewInput[];
  category?: string;            // e.g. "Electronics > Laptops"
  countryOfOrigin?: string;
  inLanguage?: string;
};

/**
 * Builds a standalone Product schema graph (includes Organization + WebSite).
 * Use this when the page IS the product detail page.
 */
export function buildProductSchema(input: ProductInput) {
  const url = toSiteUrl(input.path);
  const productId = `${url}#product`;

  const productNode: Record<string, unknown> = {
    "@type": "Product",
    "@id": productId,
    name: input.name,
    description: input.description,
    ...(input.sku ? { sku: input.sku } : {}),
    ...(input.brand
      ? { brand: { "@type": "Brand", name: input.brand } }
      : {}),
    ...(input.images && input.images.length > 0
      ? {
          image: input.images.map((img) =>
            img.width
              ? { "@type": "ImageObject", url: img.url, width: img.width, height: img.height }
              : { "@type": "ImageObject", url: img.url }
          ),
        }
      : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.countryOfOrigin
      ? { countryOfOrigin: { "@type": "Country", name: input.countryOfOrigin } }
      : {}),
    ...(input.aggregateRating
      ? { aggregateRating: buildAggregateRating(input.aggregateRating) }
      : {}),
  };

  // Add offers
  if (input.offers && input.offers.length > 0) {
    productNode["offers"] = input.offers.map((o, i) =>
      buildOffer(`${productId}/offer/${i + 1}`, o)
    );
  }

  // Add reviews
  if (input.reviews && input.reviews.length > 0) {
    productNode["review"] = input.reviews.map((r, i) =>
      buildReview(`${productId}/review/${i + 1}`, r)
    );
  }

  const graph = [
    ...baseGraph(),
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: input.name,
      description: input.description,
      isPartOf: { "@id": WEBSITE_ID },
      about: { "@id": ORGANIZATION_ID },
    },
    productNode,
  ];

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

// ---------------------------------------------------------------------------
// ItemList  (for product-listing / cluster pages with ~10-20 Product entities)
// ---------------------------------------------------------------------------

export type ItemListProduct = {
  id: string;                  // internal product id used for @id
  name: string;
  description?: string;
  url: string;                 // canonical product detail URL
  image?: string;              // main image URL
  price?: number | string;
  priceCurrency?: string;
  brand?: string;
  sku?: string;
  aggregateRating?: AggregateRatingInput;
};

export type ItemListInput = {
  path: string;                      // canonical list-page path
  name: string;                     // human-readable list title
  description: string;
  items: ItemListProduct[];
  numberOfItems?: number;           // total available (may exceed `items` array)
};

function productListItem(listUrl: string, item: ItemListProduct, position: number) {
  const itemId = `${listUrl}#product-${item.id}`;
  const node: Record<string, unknown> = {
    "@type": "ListItem",
    position,
    url: item.url,
    item: {
      "@type": "Product",
      "@id": itemId,
      name: item.name,
      ...(item.description ? { description: item.description } : {}),
      ...(item.image ? { image: { "@type": "ImageObject", url: item.image } } : {}),
      ...(item.brand ? { brand: { "@type": "Brand", name: item.brand } } : {}),
      ...(item.sku ? { sku: item.sku } : {}),
      ...(item.aggregateRating
        ? { aggregateRating: buildAggregateRating(item.aggregateRating) }
        : {}),
    },
  };

  // Nest offer inside the Product item if price data is available
  if (item.price !== undefined && item.priceCurrency) {
    const offerId = `${itemId}/offer`;
    (node.item as Record<string, unknown>)["offers"] = buildOffer(offerId, {
      price: item.price,
      priceCurrency: item.priceCurrency,
      availability: "https://schema.org/InStock",
    });
  }

  return node;
}

/**
 * Builds an ItemList schema for a product-cluster page.
 * @example
 *   buildItemListSchema({
 *     path: "/products/sg/laptops",
 *     name: "Best Laptops in Singapore",
 *     description: "Top-rated laptops from Singapore merchants",
 *     items: [...],
 *     numberOfItems: 1240,
 *   })
 */
export function buildItemListSchema(input: ItemListInput) {
  const url = toSiteUrl(input.path);

  const graph = [
    ...baseGraph(),
    {
      "@type": "CollectionPage",
      "@id": `${url}#collection`,
      url,
      name: input.name,
      description: input.description,
      inLanguage: "en-US",
      isPartOf: { "@id": WEBSITE_ID },
      about: { "@id": ORGANIZATION_ID },
    },
    {
      "@type": "ItemList",
      "@id": `${url}#itemlist`,
      name: input.name,
      description: input.description,
      ...(input.numberOfItems !== undefined
        ? { numberOfItems: input.numberOfItems }
        : {}),
      itemListElement: input.items.map((item, i) =>
        productListItem(url, item, i + 1)
      ),
    },
  ];

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

// ---------------------------------------------------------------------------
// FAQPage
// ---------------------------------------------------------------------------

export type FAQAnswer = {
  "@type": "Answer";
  text: string;
};

export type FAQQuestion = {
  "@type": "Question";
  name: string;         // the question, e.g. "How do I compare prices?"
  acceptedAnswer: FAQAnswer;
};

export type FAQPageInput = {
  path: string;
  name?: string;        // defaults to the path-based page name
  description?: string;
  questions: FAQQuestion[];
};

/**
 * Builds an FAQPage schema.  Include on any page that answers FAQ content.
 * Google AI Overviews and Bing Copilot surface FAQPage entries directly.
 */
export function buildFAQPageSchema(input: FAQPageInput) {
  const url = toSiteUrl(input.path);
  const name = input.name ?? `FAQ — ${url}`;
  const description =
    input.description ??
    `Frequently asked questions about ${name}`;

  const graph = [
    ...baseGraph(),
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name,
      description,
      isPartOf: { "@id": WEBSITE_ID },
      about: { "@id": ORGANIZATION_ID },
    },
    {
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: input.questions.map((q) => ({
        "@type": "Question",
        name: q.name,
        acceptedAnswer: q.acceptedAnswer,
      })),
    },
  ];

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}
