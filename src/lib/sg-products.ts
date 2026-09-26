export interface SGProductForSitemap {
  id: string;
  name: string;
  slug: string;   // single-segment (slug-{id}, backward compat with existing pages)
  merchantId: string;
  merchantSlug: string; // used in 2-segment sitemap URL
  lastUpdated: string;
}

interface ProductListItem {
  _id?: string;
  id?: string | number;
  title?: string;
  name?: string;
  data_updated_at?: string;
  last_updated?: string;
  updated_at?: string;
  price?: { amount?: number | null; currency?: string | null } | number | null;
  currency?: string | null;
  merchant?: string | null;
  merchant_id?: string | null;
  merchant_slug?: string | null;
  url?: string | null;
  url_status?: string | null;
}

// BUY-84237 (2026-09-26): the SG sitemap listed rows tagged country_code=SG whose
// storefront is foreign (snugglebugz.ca, CAD) — their /products/sg/ page returns 410,
// which the 4seen guard counted as 506 dead sitemap URLs. Only list products that
// actually render in the SG market.
const FOREIGN_HOST_RE = /\.(ca|com\.au|co\.uk|uk|com\.ph|ph|my|com\.my|in|co\.in|de|fr|it|es|nl|jp|co\.jp|kr|tw|hk|th|co\.th|vn|id|co\.id|nz|co\.nz|ie|us|mx|br|com\.br|ae|sa|kw|pk|bd|lk|np|za|co\.za)$/i;

function hostOf(url: unknown): string {
  if (typeof url !== "string" || !url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isSGRenderable(item: ProductListItem): boolean {
  // Reject products not priced in SGD
  const priceObj = item.price;
  const cur =
    (typeof priceObj === "object" && priceObj ? (priceObj as { currency?: string | null }).currency : null) ||
    item.currency ||
    null;
  if (cur && cur.toUpperCase() !== "SGD") return false;

  // Reject known dead URLs
  if (item.url_status === "dead") return false;

  // Reject foreign TLD merchants
  const host =
    hostOf(item.url) ||
    String(item.merchant || "").toLowerCase();
  if (host && FOREIGN_HOST_RE.test(host)) return false;

  return true;
}

interface ProductListResponse {
  data?: ProductListItem[];
  meta?: {
    total?: number;
    next_offset?: number | null;
  };
  pagination?: {
    page?: number;
    limit?: number;
    total?: number;
    total_pages?: number;
  };
}

const PRODUCT_PAGE_SIZE = 100;
const PRODUCT_SITEMAP_MAX_PAGES = 50;
const PRODUCT_CACHE_TTL_MS = 60 * 60 * 1000;

let cachedSGProducts: { products: SGProductForSitemap[]; fetchedAt: number } | null = null;
let inflightSGProducts: Promise<SGProductForSitemap[]> | null = null;

export function slugifySGProductName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function buildSGProductSlug(product: { id: string; name: string }): string {
  const nameSlug = slugifySGProductName(product.name);
  return nameSlug ? `${nameSlug}-${product.id}` : product.id;
}

export function buildMerchantSlug(merchantId: string, merchantSlug: string | null): string {
  // merchant_slug from the API is the canonical hyphenated form (e.g. "og-com-sg").
  // Fall back to slugifying merchant_id when the API didn't provide a slug.
  if (merchantSlug && merchantSlug.trim()) {
    return merchantSlug.trim();
  }
  return slugifySGProductName(merchantId);
}

async function fetchSGProductPage(baseUrl: string, apiKey: string, page: number): Promise<ProductListResponse> {
  const response = await fetch(
    `${baseUrl}/v1/products?country_code=SG&limit=${PRODUCT_PAGE_SIZE}&page=${page}&sort=created_at&order=desc`,
    {
      headers: apiKey
        ? {
            Authorization: `Bearer ${apiKey}`,
          }
        : undefined,
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json() as Promise<ProductListResponse>;
}

function normalizeSGProductItem(item: ProductListItem): SGProductForSitemap | null {
  const id = String(item._id || item.id || "").trim();
  if (!id) return null;

  // BUY-84237: apply the SG renderability filter before including in sitemap
  if (!isSGRenderable(item)) return null;

  const name = (item.name || item.title || `SG Product ${id}`).trim();
  const merchantId = String(item.merchant_id ?? item.merchant ?? "").trim();
  const merchantSlugVal = item.merchant_slug ?? null;

  return {
    id,
    name,
    slug: buildSGProductSlug({ id, name }),
    merchantId,
    merchantSlug: buildMerchantSlug(merchantId, merchantSlugVal),
    lastUpdated: item.data_updated_at || item.updated_at || item.last_updated || new Date().toISOString(),
  };
}

async function loadSGProductsFromApi(): Promise<SGProductForSitemap[]> {
  const baseUrl =
    process.env.BUYWHERE_API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
    "https://api.buywhere.ai";
  const apiKey =
    process.env.BUYWHERE_API_KEY ||
    process.env.NEXT_PUBLIC_BUYWHERE_API_KEY ||
    "";
  const products: SGProductForSitemap[] = [];
  const seenIds = new Set<string>();
  let page = 1;

  while (page <= PRODUCT_SITEMAP_MAX_PAGES) {
    const payload = await fetchSGProductPage(baseUrl, apiKey, page);
    const items = Array.isArray(payload.data) ? payload.data : [];

    for (const item of items) {
      const normalized = normalizeSGProductItem(item);
      if (!normalized || seenIds.has(normalized.id)) continue;
      seenIds.add(normalized.id);
      products.push(normalized);
    }

    const totalPages = payload.pagination?.total_pages;
    const nextOffset = payload.meta?.next_offset;
    if (items.length === 0) break;
    if (typeof totalPages === "number" && page >= totalPages) break;
    if (
      totalPages == null &&
      (nextOffset === null ||
        nextOffset === undefined ||
        items.length < PRODUCT_PAGE_SIZE)
    ) {
      break;
    }

    page += 1;
  }

  if (products.length === 0) {
    throw new Error("No SG products returned from API");
  }

  return products;
}

export async function getSGProducts(): Promise<SGProductForSitemap[]> {
  const now = Date.now();

  if (cachedSGProducts && now - cachedSGProducts.fetchedAt < PRODUCT_CACHE_TTL_MS) {
    return cachedSGProducts.products;
  }

  if (!inflightSGProducts) {
    inflightSGProducts = loadSGProductsFromApi()
      .then((products) => {
        cachedSGProducts = { products, fetchedAt: Date.now() };
        return products;
      })
      .catch((err) => {
        console.warn(
          "[sg-products] API fetch failed during build, returning empty product list:",
          err instanceof Error ? err.message : err,
        );
        return [];
      })
      .finally(() => {
        inflightSGProducts = null;
      });
  }

  return await inflightSGProducts;
}

export async function getAllSGProductIds(): Promise<string[]> {
  const products = await getSGProducts();
  return products.map((p) => p.id);
}
