export interface SGProductForSitemap {
  id: string;
  name: string;
  slug: string;
  lastUpdated: string;
}

interface GetSGProductsOptions {
  allowMockFallback?: boolean;
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
  const baseUrl = process.env.NEXT_PUBLIC_BUYWHERE_API_URL || "https://api.buywhere.ai";
  const apiKey = process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";
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

let mockSgProducts: SGProductForSitemap[] | null = null;

function generateMockSGProducts(): SGProductForSitemap[] {
  if (mockSgProducts) return mockSgProducts;

  const productNames = [
    "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
    "Apple iPhone 16 Pro Max 256GB",
    "Samsung Galaxy S25 Ultra",
    "Dyson V15 Detect Cordless Vacuum",
    "Nintendo Switch OLED",
    "Apple MacBook Air M4",
    "LG 65-inch OLED evo C4 TV",
    "Bose QuietComfort Ultra Earbuds",
    "Samsung Galaxy Tab S10 Ultra",
    "Sony X90L 75-inch 4K TV",
    "Marshall Stanmore III Bluetooth Speaker",
    "Philips Air Purifier 3000 Series",
    "Instant Pot Pro 8-Quart",
    "Dyson Airwrap Complete Styler",
    "Samsung Bespoke Jet AI Vacuum",
  ];

  const now = new Date();
  mockSgProducts = productNames.map((name, idx) => {
    const id = `sg-product-${idx}`;
    return {
      id,
      name,
      slug: buildSGProductSlug({ id, name }),
      lastUpdated: new Date(now.getTime() - Math.random() * 86400000 * 7).toISOString(),
    };
  });

  return mockSgProducts;
}

export async function getSGProducts(options: GetSGProductsOptions = {}): Promise<SGProductForSitemap[]> {
  const { allowMockFallback = true } = options;
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
      .catch((error) => {
        if (!allowMockFallback) {
          throw error;
        }

        return generateMockSGProducts();
      })
      .finally(() => {
        inflightSGProducts = null;
      });
  }

  try {
    return await inflightSGProducts;
  } catch {
    if (allowMockFallback) {
      return generateMockSGProducts();
    }

    throw new Error("Failed to load SG products");
  }
}

export async function getAllSGProductIds(): Promise<string[]> {
  const products = await getSGProducts();
  return products.map((p) => p.id);
}
