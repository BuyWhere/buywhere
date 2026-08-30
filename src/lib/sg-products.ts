export interface SGProductForSitemap {
  id: string;
  name: string;
  slug: string;
  lastUpdated: string;
}

interface ProductListItem {
  _id?: string;
  id?: string | number;
  title?: string;
  name?: string;
  data_updated_at?: string;
  last_updated?: string;
}

interface ProductListResponse {
  data?: ProductListItem[];
  meta?: {
    total?: number;
    next_offset?: number | null;
  };
}

const PRODUCT_PAGE_SIZE = 100;
const PRODUCT_CACHE_TTL_MS = 60 * 60 * 1000;

let cachedSGProducts: { products: SGProductForSitemap[]; fetchedAt: number } | null = null;
let inflightSGProducts: Promise<SGProductForSitemap[]> | null = null;

export function slugifySGProductName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function buildSGProductSlug(product: { id: string; name: string }): string {
  const nameSlug = slugifySGProductName(product.name);
  return nameSlug ? `${nameSlug}-${product.id}` : product.id;
}

async function fetchSGProductPage(baseUrl: string, apiKey: string, offset: number): Promise<ProductListResponse> {
  const response = await fetch(
    `${baseUrl}/v1/products?country_code=SG&limit=${PRODUCT_PAGE_SIZE}&offset=${offset}&sort_by=relevance`,
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

  return response.json() as Promise<ProductListResponse>;
}

function normalizeSGProductItem(item: ProductListItem): SGProductForSitemap | null {
  const id = String(item._id || item.id || "").trim();
  if (!id) {
    return null;
  }

  const name = (item.name || item.title || `SG Product ${id}`).trim();

  return {
    id,
    name,
    slug: buildSGProductSlug({ id, name }),
    lastUpdated: item.data_updated_at || item.last_updated || new Date().toISOString(),
  };
}

async function loadSGProductsFromApi(): Promise<SGProductForSitemap[]> {
  const baseUrl = process.env.BUYWHERE_API_INTERNAL_URL || process.env.NEXT_PUBLIC_BUYWHERE_API_URL || "https://api.buywhere.ai";
  const apiKey = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";
  const products: SGProductForSitemap[] = [];
  const seenIds = new Set<string>();
  let offset = 0;

  while (true) {
    const payload = await fetchSGProductPage(baseUrl, apiKey, offset);
    const items = Array.isArray(payload.data) ? payload.data : [];

    for (const item of items) {
      const normalized = normalizeSGProductItem(item);
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
        console.warn('[sg-products] API fetch failed during build, returning empty product list:', err instanceof Error ? err.message : err);
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
