export interface USMerchantPrice {
  merchant: string;
  price: string | null;
  url: string;
  inStock: boolean;
  rating?: number;
  lastUpdated: string;
  primeEligible?: boolean;
  storePickup?: boolean;
  price_missing_reason?: "not_found" | "retailer_unavailable" | "scraping_failed" | "product_discontinued";
}

export interface USProduct {
  id: string;
  name: string;
  image: string;
  description: string;
  specs: Record<string, string>;
  prices: USMerchantPrice[];
  msrp?: string;
  overallRating: number;
  reviewCount: number;
  brand: string;
  sku: string;
  asin?: string;
  walmartId?: string;
  targetId?: string;
  bestBuyId?: string;
  lastUpdated?: string;
}

export interface USProductForSitemap {
  id: string;
  name: string;
  slug: string;
  lastUpdated: string;
}

export interface USProductOfferApiItem {
  merchant?: string | null;
  merchant_name?: string | null;
  source?: string | null;
  platform?: string | null;
  price?: number | string | null;
  current_price?: number | string | null;
  url?: string | null;
  product_url?: string | null;
  buy_url?: string | null;
  affiliate_url?: string | null;
  affiliate_redirect_url?: string | null;
  click_url?: string | null;
  in_stock?: boolean | null;
  available?: boolean | null;
  rating?: number | null;
  last_updated?: string | null;
  updated_at?: string | null;
}

export function normalizeUSMerchantPrice(item: USProductOfferApiItem): USMerchantPrice | null {
  const merchant = (item.merchant || item.merchant_name || item.source || item.platform || "").trim();
  const url = (
    item.affiliate_redirect_url ||
    item.click_url ||
    item.affiliate_url ||
    item.buy_url ||
    item.url ||
    item.product_url ||
    ""
  ).trim();

  if (!merchant || !url || url === "#") return null;

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return null;
  } catch {
    return null;
  }

  const rawPrice = item.price ?? item.current_price ?? null;
  const price = rawPrice === null ? null : String(rawPrice);
  const inStock = typeof item.in_stock === "boolean"
    ? item.in_stock
    : typeof item.available === "boolean"
      ? item.available
      : true;

  return {
    merchant,
    price,
    url,
    inStock,
    rating: typeof item.rating === "number" ? item.rating : undefined,
    lastUpdated: item.last_updated || item.updated_at || new Date().toISOString(),
  };
}

interface ProductListApiItem {
  _id?: string;
  id?: string | number;
  title?: string;
  name?: string;
  data_updated_at?: string;
  last_updated?: string;
}

interface ProductListApiResponse {
  data?: ProductListApiItem[];
  meta?: {
    total?: number;
    next_offset?: number | null;
  };
}

const PRODUCT_PAGE_SIZE = 100;
const PRODUCT_CACHE_TTL_MS = 60 * 60 * 1000;

let cachedUSProducts: { products: USProductForSitemap[]; fetchedAt: number } | null = null;
let inflightUSProducts: Promise<USProductForSitemap[]> | null = null;

export function slugifyUSProductName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function buildUSProductSlug(product: { id: string; name: string }): string {
  const nameSlug = slugifyUSProductName(product.name);
  return nameSlug ? `${nameSlug}-${product.id}` : product.id;
}

async function fetchUSProductPage(baseUrl: string, apiKey: string, offset: number): Promise<ProductListApiResponse> {
  const response = await fetch(
    `${baseUrl}/v1/products?country_code=US&limit=${PRODUCT_PAGE_SIZE}&offset=${offset}&sort_by=relevance`,
    {
      headers: apiKey
        ? {
            Authorization: `Bearer ${apiKey}`,
          }
        : undefined,
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json() as Promise<ProductListApiResponse>;
}

function normalizeUSProductItem(item: ProductListApiItem): USProductForSitemap | null {
  const id = String(item._id || item.id || "").trim();
  if (!id) {
    return null;
  }

  const name = (item.name || item.title || `US Product ${id}`).trim();

  return {
    id,
    name,
    slug: buildUSProductSlug({ id, name }),
    lastUpdated: item.data_updated_at || item.last_updated || new Date().toISOString(),
  };
}

async function loadUSProductsFromApi(): Promise<USProductForSitemap[]> {
  const baseUrl = process.env.BUYWHERE_API_INTERNAL_URL || process.env.NEXT_PUBLIC_BUYWHERE_API_URL || "https://api.buywhere.ai";
  const apiKey = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";
  const products: USProductForSitemap[] = [];
  const seenIds = new Set<string>();
  let offset = 0;

  while (true) {
    const payload = await fetchUSProductPage(baseUrl, apiKey, offset);
    const items = Array.isArray(payload.data) ? payload.data : [];

    for (const item of items) {
      const normalized = normalizeUSProductItem(item);
      if (!normalized || seenIds.has(normalized.id)) {
        continue;
      }

      seenIds.add(normalized.id);
      products.push(normalized);
    }

    const nextOffset = payload.meta?.next_offset;
    if (nextOffset === null || nextOffset === undefined || nextOffset <= offset || items.length === 0) {
      break;
    }

    offset = nextOffset;
  }

  if (products.length === 0) {
    throw new Error("No US products returned from API");
  }

  return products;
}

export async function getUSProducts(): Promise<USProductForSitemap[]> {
  const now = Date.now();

  if (cachedUSProducts && now - cachedUSProducts.fetchedAt < PRODUCT_CACHE_TTL_MS) {
    return cachedUSProducts.products;
  }

  if (!inflightUSProducts) {
    inflightUSProducts = loadUSProductsFromApi()
      .then((products) => {
        cachedUSProducts = { products, fetchedAt: Date.now() };
        return products;
      })
      .catch((err) => {
        console.warn('[us-products] API fetch failed during build, returning empty product list:', err instanceof Error ? err.message : err);
        return [];
      })
      .finally(() => {
        inflightUSProducts = null;
      });
  }

  return await inflightUSProducts;
}

export async function getAllUSProductIds(): Promise<string[]> {
  const products = await getUSProducts();
  return products.map((p) => p.id);
}
