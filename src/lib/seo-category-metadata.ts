import type { Metadata } from "next";
import { getCategoryBySlug } from "@/lib/taxonomy";
import { toSiteUrl } from "@/lib/site-url";

type CollectionPageMetadataConfig = {
  title: string;
  description: string;
  path: string;
  siteName?: string;
  locale?: string;
};

function buildCollectionPageMetadata({
  title,
  description,
  path,
  siteName = "BuyWhere",
  locale,
}: CollectionPageMetadataConfig): Metadata {
  const canonical = toSiteUrl(path);

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      siteName,
      locale,
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    robots: {
      index: true,
      follow: true,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.png"],
    },
  };
}

export function buildCompareCategoryMetadata(slug: string): Metadata {
  const category = getCategoryBySlug(slug);
  const name = category?.name || "Products";
  const description =
    category?.description
      ? `Compare ${name.toLowerCase()} prices with live merchant coverage from BuyWhere. ${category.description}.`
      : `Compare ${name.toLowerCase()} prices with live merchant coverage from BuyWhere.`;

  return buildCollectionPageMetadata({
    title: `${name} Price Comparison | BuyWhere`,
    description,
    path: `/compare/${slug}/`,
    locale: "en_SG",
  });
}

export function buildSgCategoryMetadata(title: string, description: string, slug: string): Metadata {
  return buildCollectionPageMetadata({
    title,
    description,
    path: `/categories/${slug}/`,
    locale: "en_SG",
  });
}

export function buildCategoriesIndexMetadata(): Metadata {
  return buildCollectionPageMetadata({
    title: "Browse BuyWhere Catalog — Search 1M+ Products Across 6 Countries",
    description:
      "Explore BuyWhere product categories across Singapore, the US, the UK, Australia, the Philippines, and Malaysia.",
    path: "/categories/",
  });
}

export function buildCompareIndexMetadata(): Metadata {
  return buildCollectionPageMetadata({
    title: "Compare Product Prices Across Retailers | BuyWhere",
    description:
      "Compare product prices across major retailers and markets with BuyWhere. Search by query or IDs to see merchant, availability, and price spread in one view.",
    path: "/compare/",
  });
}
