/**
 * BUY-75418 — Server-side category product fetching for SSR grids.
 */

import type { CategoryProduct } from "@/components/seo/CategoryProductGrid";

const API_BASE_URL = (
  process.env.BUYWHERE_API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
  "https://api.buywhere.ai"
).replace(/\/$/, "");

const API_KEY =
  process.env.BUYWHERE_API_KEY ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_KEY ||
  process.env.BUYWHERE_API_INTERNAL_KEY;

interface ApiSearchItem {
  id: string | number;
  name?: string | null;
  title?: string | null;
  price?: number | string | { amount?: number | string | null; currency?: string | null } | null;
  current_price?: number | string | { amount?: number | string | null; currency?: string | null } | null;
  currency?: string | null;
  merchant?: string | null;
  merchant_name?: string | null;
  source?: string | null;
  platform?: string | null;
  image_url?: string | null;
  affiliate_redirect_url?: string | null;
  click_url?: string | null;
  affiliate_url?: string | null;
  buy_url?: string | null;
}

function normalizeApiItem(item: ApiSearchItem): CategoryProduct | null {
  const merchant = item.merchant || item.merchant_name || item.source || item.platform || "";
  if (!merchant) return null;

  const rawPrice = item.price ?? item.current_price ?? null;
  const priceObject = typeof rawPrice === "object" && rawPrice !== null ? rawPrice : null;
  const numericPrice = priceObject?.amount != null
    ? Number(priceObject.amount)
    : rawPrice !== null
      ? Number(rawPrice)
      : null;
  const currency = item.currency || priceObject?.currency || "USD";

  const affiliate_redirect_url =
    item.affiliate_redirect_url ||
    item.click_url ||
    item.affiliate_url ||
    item.buy_url ||
    null;

  const name = item.name || item.title || "Product";

  return {
    id: item.id,
    name: String(name),
    price: numericPrice,
    currency,
    merchant,
    image_url: item.image_url ?? null,
    affiliate_redirect_url,
  };
}

export async function fetchCategoryProducts(
  category: string,
  country: "US" | "SG" = "US",
  limit: number = 12
): Promise<CategoryProduct[]> {
  if (!API_KEY) {
    console.warn("[category-products] No API key configured, returning empty array");
    return [];
  }

  const countryCode = country === "US" ? "US" : "SG";
  const params = new URLSearchParams({
    q: category,
    limit: String(limit),
    country_code: countryCode,
  });

  try {
    const response = await fetch(`${API_BASE_URL}/v1/products/search?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
      next: { revalidate: 300 }, // 5-minute cache
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.warn(`[category-products] API returned ${response.status}`);
      return [];
    }

    const data = await response.json();
    const items = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.products)
        ? data.products
        : Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data?.results)
            ? data.results
            : [];

    const rawItems = items as Array<ApiSearchItem>;
    const products = (rawItems as ApiSearchItem[])
      .map(normalizeApiItem)
      .filter((p): p is CategoryProduct => p !== null && p.price !== null && Number.isFinite(p.price))
      .slice(0, limit);

    return products;
  } catch (error) {
    console.warn(`[category-products] Fetch error:`, error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Map category slugs to search queries for the API.
 */
export function categorySlugToSearchQuery(slug: string): string {
  const mapping: Record<string, string> = {
    electronics: "electronics",
    "electronics-us": "electronics",
    fashion: "fashion clothing",
    "fashion-us": "fashion clothing",
    "home-living": "home kitchen furniture",
    "home-living-us": "home kitchen furniture",
    beauty: "beauty skincare makeup",
    "beauty-us": "beauty skincare makeup",
    "beauty-health": "beauty health personal care",
    grocery: "grocery food household",
    "grooming-products": "grooming personal care",
    "laptops-computers": "laptops computers",
    "tvs-home-entertainment": "TVs home entertainment",
    "headphones-audio": "headphones audio",
    gaming: "gaming",
    "cameras-photography": "cameras photography",
    "smart-home": "smart home devices",
    "mens-clothing": "men's clothing fashion",
    "womens-clothing": "women's clothing fashion",
    "shoes-footwear": "shoes footwear",
    accessories: "accessories fashion",
    furniture: "furniture home",
    "kitchen-appliances": "kitchen appliances",
    cookware: "cookware kitchen",
    "home-decor": "home decor",
    skincare: "skincare beauty",
    makeup: "makeup beauty",
    haircare: "haircare beauty",
    fragrances: "fragrances perfume",
  };

  return mapping[slug] || slug.replace(/-/g, " ");
}
