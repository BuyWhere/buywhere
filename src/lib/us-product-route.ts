import { cache } from "react";
import {
  buildUSProductSlug,
  getUSProducts,
  normalizeUSMerchantPrice,
  slugifyUSProductName,
  type USProduct,
} from "@/lib/us-products";

export interface ResolvedUSProductRoute {
  id: string;
  name: string;
  slug: string;
  lastUpdated: string;
  initialData?: USProduct;
}

type SearchProduct = {
  id?: string | number;
  name?: string | null;
  title?: string | null;
  brand?: string | null;
  category?: string | null;
  merchant?: string | null;
  merchant_name?: string | null;
  source?: string | null;
  price?: number | string | { amount?: number | string | null } | null;
  price_amount?: number | string | null;
  image?: string | null;
  image_url?: string | null;
  url?: string | null;
  product_url?: string | null;
  buy_url?: string | null;
  affiliate_url?: string | null;
  affiliate_redirect_url?: string | null;
  click_url?: string | null;
  in_stock?: boolean | null;
  available?: boolean | null;
  rating?: number | null;
  updated_at?: string | null;
  last_updated?: string | null;
};

type SearchResponse = {
  data?: SearchProduct[];
  items?: SearchProduct[];
  results?: SearchProduct[];
  products?: SearchProduct[];
};

function productImage(value?: string | null): string {
  if (!value) return "";

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function searchProductPrice(product: SearchProduct): number | string | null {
  if (product.price && typeof product.price === "object") {
    return product.price.amount ?? null;
  }

  return product.price_amount ?? product.price ?? null;
}

function searchMatchScore(name: string, queryTokens: string[]): number {
  const candidateTokens = slugifyUSProductName(name).split("-").filter(Boolean);
  if (!queryTokens.every((token) => candidateTokens.includes(token))) {
    return -1;
  }

  return queryTokens.length * 10 - Math.max(0, candidateTokens.length - queryTokens.length);
}

async function resolveNameOnlyUSProduct(normalizedParam: string): Promise<ResolvedUSProductRoute | null> {
  const queryTokens = normalizedParam
    .split("-")
    .filter((token) => token.length > 1 && !/^\d+$/.test(token));
  if (queryTokens.length === 0) return null;

  const origin = process.env.BUYWHERE_INTERNAL_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || "https://buywhere.ai";
  const params = new URLSearchParams({
    q: normalizedParam.replace(/-/g, " "),
    country: "us",
    limit: "20",
  });

  try {
    const response = await fetch(`${origin}/api/products/search?${params.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 * 15 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;

    const payload = await response.json() as SearchResponse;
    const products = payload.data || payload.items || payload.results || payload.products || [];
    const candidates = products
      .map((product) => {
        const id = String(product.id ?? "").trim();
        const name = (product.name || product.title || "").trim();
        const image = productImage(product.image_url || product.image);
        const price = searchProductPrice(product);
        const offer = normalizeUSMerchantPrice({
          merchant: product.merchant,
          merchant_name: product.merchant_name,
          source: product.source,
          price,
          url: product.url,
          product_url: product.product_url,
          buy_url: product.buy_url,
          affiliate_url: product.affiliate_url,
          affiliate_redirect_url: product.affiliate_redirect_url,
          click_url: product.click_url,
          in_stock: product.in_stock,
          available: product.available,
          rating: product.rating,
          updated_at: product.updated_at,
          last_updated: product.last_updated,
        });

        return {
          id,
          name,
          image,
          offer,
          product,
          score: name ? searchMatchScore(name, queryTokens) : -1,
        };
      })
      .filter((candidate) => candidate.id && candidate.name && candidate.image && candidate.offer?.price !== null && candidate.score >= 0)
      .sort((a, b) => b.score - a.score);

    const match = candidates[0];
    if (!match?.offer) return null;

    const brand = match.product.brand?.trim() || match.name.split(/\s+/)[0] || "";
    const lastUpdated = match.product.updated_at || match.product.last_updated || match.offer.lastUpdated;
    const slug = buildUSProductSlug({ id: match.id, name: match.name });

    return {
      id: match.id,
      name: match.name,
      slug,
      lastUpdated,
      initialData: {
        id: match.id,
        name: match.name,
        image: match.image,
        description: `Compare the current catalog offer for ${match.name}.`,
        specs: {
          ...(brand ? { Brand: brand } : {}),
          ...(match.product.category ? { Category: match.product.category } : {}),
        },
        prices: [match.offer],
        overallRating: 0,
        reviewCount: 0,
        brand,
        sku: `SKU-${match.id}`,
        lastUpdated,
      },
    };
  } catch {
    return null;
  }
}

export const resolveUSProductRoute = cache(async (param: string): Promise<ResolvedUSProductRoute | null> => {
  const normalizedParam = decodeURIComponent(param).toLowerCase();
  const isCatalogAddress = /^\d+$/.test(normalizedParam) || /-\d{5,}$/.test(normalizedParam);

  if (!isCatalogAddress) {
    const searchMatch = await resolveNameOnlyUSProduct(normalizedParam);
    if (searchMatch) return searchMatch;
  }

  const products = await getUSProducts();

  const directMatch = products.find((product) => product.id.toLowerCase() === normalizedParam);
  if (directMatch) {
    return directMatch;
  }

  const slugMatch = products.find((product) => product.slug.toLowerCase() === normalizedParam);
  if (slugMatch) {
    return slugMatch;
  }

  const suffixMatch = products.find((product) => normalizedParam.endsWith(`-${product.id.toLowerCase()}`));
  if (suffixMatch) {
    return {
      ...suffixMatch,
      slug: buildUSProductSlug(suffixMatch),
    };
  }

  const nameOnlyMatch = products.find((product) => slugifyUSProductName(product.name) === normalizedParam);
  if (nameOnlyMatch) {
    return nameOnlyMatch;
  }

  return null;
});
