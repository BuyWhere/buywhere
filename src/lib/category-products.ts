import { normalizeComparisonOffer, type ComparisonOffer } from "@/lib/compare-page";

const BASE_URL = "https://buywhere.ai";
const INTERNAL_ORIGIN =
  process.env.BUYWHERE_INTERNAL_ORIGIN ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  BASE_URL;

type SearchApiResponseMeta = {
  total?: number;
  degraded?: boolean;
  hint?: string;
};

type SearchApiResponse = {
  data?: unknown[];
  items?: unknown[];
  results?: unknown[];
  meta?: SearchApiResponseMeta | null;
  degraded?: boolean;
  total?: number;
  hint?: string;
};

type RawSearchItem = Record<string, unknown> & {
  id?: string | number | null;
  name?: string | null;
  title?: string | null;
  price?: number | string | { amount?: number | string | null; currency?: string | null } | null;
  price_amount?: number | string | null;
  price_currency?: string | null;
  currency?: string | null;
  merchant_name?: string | null;
  merchant?: string | null;
  source?: string | null;
};

export type CategoryProductCountry = "US" | "SG";

export type CategoryProduct = {
  id: string;
  name: string;
  merchant: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  href: string;
  availability: string;
  inStock: boolean | null;
  brand: string | null;
  category: string | null;
};

const COUNTRY_CONFIG: Record<CategoryProductCountry, { currency: string; locale: string }> = {
  US: { currency: "USD", locale: "en-US" },
  SG: { currency: "SGD", locale: "en-SG" },
};

export function getCategoryProductLocale(country: CategoryProductCountry): string {
  return COUNTRY_CONFIG[country].locale;
}

function normalizeAffiliateHref(href: string): string | null {
  if (!href || href === "#") return null;
  if (href.startsWith("/r/")) return href;

  try {
    const url = new URL(href);
    if (url.pathname.startsWith("/r/")) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
  }

  return null;
}

function coerceSearchItem(item: RawSearchItem): Parameters<typeof normalizeComparisonOffer>[0] {
  const objectPrice = item.price && typeof item.price === "object" && !Array.isArray(item.price) ? item.price : null;
  const priceAmount = objectPrice && "amount" in objectPrice ? objectPrice.amount : item.price_amount ?? item.price;
  const priceCurrency = objectPrice && "currency" in objectPrice ? objectPrice.currency : item.price_currency ?? item.currency;

  return {
    ...item,
    price: typeof priceAmount === "number" || typeof priceAmount === "string" ? priceAmount : null,
    currency: typeof priceCurrency === "string" ? priceCurrency : undefined,
    merchant: item.merchant_name || item.merchant || item.source || undefined,
  } as Parameters<typeof normalizeComparisonOffer>[0];
}

function toCategoryProduct(offer: ComparisonOffer): CategoryProduct | null {
  if (offer.price === null) return null;
  if (!offer.name || !offer.merchant) return null;

  const href = normalizeAffiliateHref(offer.href);
  if (!href) return null;

  return {
    id: offer.id,
    name: offer.name,
    merchant: offer.merchant,
    price: offer.price,
    currency: offer.currency,
    imageUrl: offer.imageUrl,
    href,
    availability: offer.availability,
    inStock: offer.inStock,
    brand: offer.brand,
    category: offer.category,
  };
}

export async function fetchCategoryProducts({
  queries,
  category,
  country,
  limit = 12,
}: {
  queries: string[];
  category?: string;
  country: CategoryProductCountry;
  limit?: number;
}): Promise<CategoryProduct[]> {
  const config = COUNTRY_CONFIG[country];
  const collected: CategoryProduct[] = [];
  const seen = new Set<string>();

  // One search call; never throws. Returns [] on timeout/HTTP error/degraded/empty.
  async function searchOnce(query: string, attemptCategory: string | null): Promise<CategoryProduct[]> {
    const attemptParams = new URLSearchParams({
      q: query,
      country,
      deliver_to: country,
      include_unshippable: "false",
      limit: String(Math.max(limit * 3, 24)),
    });
    if (attemptCategory) {
      attemptParams.set("category", attemptCategory);
    }

    try {
      const response = await fetch(`${INTERNAL_ORIGIN}/api/products/search?${attemptParams.toString()}`, {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 * 15 },
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        console.warn(`[category-products] search HTTP ${response.status} for ${country} query="${query}"`);
        return [];
      }

      const data = (await response.json()) as SearchApiResponse;
      const meta = data.meta ?? null;
      const isDegraded = Boolean(meta?.degraded ?? data.degraded);
      const total = typeof meta?.total === "number" ? meta.total : data.total;

      if (isDegraded || total === 0) {
        console.warn(
          `[category-products] degraded/empty search for ${country} query="${query}": degraded=${isDegraded}, total=${total}`,
        );
        return [];
      }

      const items = data.data || data.items || data.results || [];
      if (!Array.isArray(items)) return [];

      const products: CategoryProduct[] = [];
      for (const item of items) {
        const product = toCategoryProduct(
          normalizeComparisonOffer(coerceSearchItem(item as RawSearchItem), config.currency),
        );
        if (product) products.push(product);
      }
      return products;
    } catch (err) {
      console.warn(`[category-products] fetch failure for ${country} query="${query}":`, err);
      return [];
    }
  }

  function merge(batches: CategoryProduct[][]) {
    for (const batch of batches) {
      for (const product of batch) {
        if (collected.length >= limit) return;
        const key = `${product.id}:${product.name.toLowerCase()}:${product.merchant.toLowerCase()}:${product.href}`;
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(product);
      }
    }
  }

  // Queries run concurrently per round (they used to run one after another, so a slow or
  // degraded search API turned /us/electronics into a 40-50 s render). Results are merged in
  // query order, so the page shows the same products as before. Round 1 is category-scoped
  // when a category is given; round 2 (unscoped) only runs if round 1 came up short.
  const rounds: (string | null)[] = category ? [category, null] : [null];
  for (const attemptCategory of rounds) {
    if (collected.length >= limit) break;
    merge(await Promise.all(queries.map((query) => searchOnce(query, attemptCategory))));
  }

  return collected.slice(0, limit);
}
