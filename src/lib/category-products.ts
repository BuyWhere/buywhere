/**
 * Server-side fetcher for category-page product grids.
 *
 * BUY-75418 — these grids must be present in the initial SSR HTML so that AI
 * crawlers (OAI-SearchBot, ClaudeBot, PerplexityBot) see name + price + retailer
 * + /r link without executing JavaScript. Lives server-side; never use in a
 * 'use client' component.
 */

// NOTE: This module is server-only. It must never be imported from a
// 'use client' component. We intentionally omit the `import "server-only"`
// declaration so the module compiles without the optional `server-only`
// package; the discipline is enforced by the consuming components
// (CategoryProductGrid is an async server component).

export interface CategoryGridProduct {
  id: string;
  name: string;
  brand: string | null;
  price: number;
  currency: string;
  merchant: string;
  merchantSlug: string | null;
  imageUrl: string | null;
  affiliateRedirectUrl: string;
  detailUrl: string;
  categoryPath: string[];
  availability: string | null;
}

export interface CategoryGridInput {
  /** Canonical category slug (electronics, fashion, home-living, beauty, beauty-health, grocery). */
  category: string;
  /** ISO 3166-1 alpha-2 country code — drives both the API and currency. */
  countryCode: string;
  /** Number of products to return (default 12). */
  limit?: number;
}

export interface CategoryGridResult {
  products: CategoryGridProduct[];
  fetchedAt: string;
  source: "api" | "fallback-empty";
}

// BUY-75418: server-side fetcher.
//
// Strategy:
//   1. In production, the site already has BUYWHERE_API_KEY configured on
//      the Railway service (required for /api/products/search to work).
//      We call api.buywhere.ai directly with that key — same env contract
//      as src/app/api/products/search/route.ts uses.
//   2. As a defensive secondary path, if BUYWHERE_SELF_URL is set we
//      round-trip through the same Next.js app's /api/products/search
//      proxy. This protects against a future build that strips server
//      envs (e.g. for static export) and keeps a single auth path.
//   3. In dev or local, fall back to NEXT_PUBLIC_BUYWHERE_API_KEY.
const FALLBACK_API_BASE =
  process.env.BUYWHERE_API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
  "https://api.buywhere.ai";

const FALLBACK_API_KEY =
  process.env.BUYWHERE_API_KEY ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_KEY ||
  "";

const SELF_PROXY_URL =
  process.env.BUYWHERE_SELF_URL ||
  process.env.SITE_URL ||
  "";

function resolveFetchTarget(): { url: string; headers: Record<string, string> } {
  if (FALLBACK_API_KEY) {
    return {
      url: `${FALLBACK_API_BASE.replace(/\/$/, "")}/v1/products/search`,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${FALLBACK_API_KEY}`,
      },
    };
  }
  if (SELF_PROXY_URL) {
    return {
      url: `${SELF_PROXY_URL.replace(/\/$/, "")}/api/products/search`,
      headers: { Accept: "application/json" },
    };
  }
  return {
    url: `${FALLBACK_API_BASE.replace(/\/$/, "")}/v1/products/search`,
    headers: { Accept: "application/json" },
  };
}

// Curated fallback queries per category — guaranteed to return >= 12 priced
// products even when the primary term is sparse. The first query with a
// successful, sufficient response wins.
const CATEGORY_QUERY_BANK: Record<string, string[]> = {
  electronics: ["laptop", "smartphone", "headphones", "tablet"],
  fashion: ["shoes", "dress", "jacket", "tshirt"],
  "home-living": ["kitchen", "furniture", "bedding", "decor"],
  beauty: ["skincare", "makeup", "perfume", "shampoo"],
  "beauty-health": ["skincare", "makeup", "perfume", "shampoo"],
  grocery: ["snacks", "coffee", "tea", "beverages"],
  "sports-outdoors": ["fitness", "bicycle", "camping", "running"],
  "health-wellness": ["vitamins", "supplements", "protein", "wellness"],
  "toys-games": ["lego", "puzzle", "board game", "console"],
};

const DEFAULT_QUERIES = ["popular", "best seller", "trending", "top"];

function pickCategorySlug(input: string): string {
  return input.toLowerCase().trim();
}

function buildDetailUrl(productId: string, countryCode: string, name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
  const region = countryCode.toLowerCase() === "sg" ? "sg" : "us";
  const safeSlug = slug ? `${slug}-${productId}` : productId;
  return `/products/${region}/${safeSlug}`;
}

function mapProduct(raw: Record<string, unknown>, countryCode: string): CategoryGridProduct {
  const id = String(raw.id ?? "");
  const name = String(raw.title ?? raw.name ?? "Product");
  const priceObj = (raw.price as { amount?: number; currency?: string } | undefined) ?? {};
  const amount =
    typeof priceObj.amount === "number"
      ? priceObj.amount
      : typeof raw.price === "number"
      ? raw.price
      : 0;
  const currency = priceObj.currency ?? "USD";
  const merchantName =
    (raw.merchant_name as string | undefined) ??
    (raw.merchant as string | undefined) ??
    "Retailer";
  const merchantSlug =
    (raw.merchant_slug as string | undefined) ??
    ((raw.merchant as string | undefined) ?? null);
  const imageUrl =
    (raw.image_url as string | undefined) ??
    (raw.thumbnail as string | undefined) ??
    null;
  const affiliateRedirectUrl =
    (raw.affiliate_redirect_url as string | undefined) ??
    `/r/direct/${id}`;
  const categoryPath = Array.isArray(raw.category_path)
    ? (raw.category_path as string[])
    : [];

  return {
    id,
    name,
    brand: (raw.brand as string | undefined) ?? null,
    price: amount,
    currency,
    merchant: merchantName,
    merchantSlug,
    imageUrl,
    affiliateRedirectUrl,
    detailUrl: buildDetailUrl(id, countryCode, name),
    categoryPath,
    availability:
      (raw.availability as string | undefined) ??
      ((raw.metadata as { availability?: string } | undefined)?.availability ?? null),
  };
}

async function fetchWithQuery(
  query: string,
  countryCode: string,
  limit: number
): Promise<CategoryGridProduct[]> {
  const target = resolveFetchTarget();
  const url = new URL(target.url);
  url.searchParams.set("q", query);
  url.searchParams.set("country_code", countryCode);
  url.searchParams.set("limit", String(limit));

  try {
    const res = await fetch(url.toString(), {
      headers: target.headers,
      // Cache for 5 minutes at the Next.js data cache so repeated SSG builds
      // don't hammer the API. The upstream TTL on /v1/products/search is
      // already 5 minutes (see src/lib/sg-products.ts pattern).
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      return [];
    }

    const data = (await res.json()) as {
      data?: unknown[];
      products?: unknown[];
      results?: unknown[];
      items?: unknown[];
    };

    const list =
      data.data ?? data.products ?? data.results ?? data.items ?? [];

    return list
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => mapProduct(entry, countryCode))
      .filter((p) => p.price > 0);
  } catch {
    return [];
  }
}

/**
 * Fetch a server-rendered grid of products for a category landing page.
 *
 * Tries the category-specific query bank first; if the first query returns
 * fewer than `limit` priced products, walks the bank until the threshold is
 * met or the bank is exhausted. Always returns an array (empty on failure).
 */
export async function fetchCategoryGridProducts(
  input: CategoryGridInput
): Promise<CategoryGridResult> {
  const limit = input.limit ?? 12;
  const slug = pickCategorySlug(input.category);
  const bank = CATEGORY_QUERY_BANK[slug] ?? DEFAULT_QUERIES;

  for (const query of bank) {
    const products = await fetchWithQuery(
      query,
      input.countryCode,
      limit
    );
    if (products.length >= limit) {
      return {
        products: products.slice(0, limit),
        fetchedAt: new Date().toISOString(),
        source: "api",
      };
    }
  }

  // Last resort — return whatever we have from the first successful query so
  // the page is not literally empty. Governance rule #10 (BUY-60872) says
  // never invent catalog data; we surface only what the API returned.
  const lastAttempt = await fetchWithQuery(
    bank[0] ?? DEFAULT_QUERIES[0],
    input.countryCode,
    limit
  );

  return {
    products: lastAttempt.slice(0, limit),
    fetchedAt: new Date().toISOString(),
    source: lastAttempt.length > 0 ? "api" : "fallback-empty",
  };
}