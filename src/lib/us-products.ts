export interface USMerchantPrice {
  merchant: "Amazon.com" | "Walmart" | "Target" | "Best Buy";
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

export function generateMockUSProducts(): USProduct[] {
  const products: USProduct[] = [];
  const productNames = [
    "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
    "Apple AirPods Pro 2nd Generation",
    "Samsung Galaxy Buds2 Pro Earbuds",
    "Bose QuietComfort 45 Headphones",
    "JBL Tune 770NC Wireless Over-Ear Headphones",
    "Apple Watch Series 9 GPS 45mm",
    "Samsung Galaxy Watch 6 Classic",
    "Fitbit Charge 6 Fitness Tracker",
    "Garmin Forerunner 265 Smartwatch",
    "Dyson V15 Detect Cordless Vacuum",
    "iRobot Roomba j7+ Self-Emptying Robot Vacuum",
    "Shark Navigator Lift-Away Upright Vacuum",
    "Ninja Foodi 9-in-1 Pressure Cooker & Air Fryer",
    "Instant Pot Pro Plus 8-Quart",
    "KitchenAid Stand Mixer 5-Quart",
  ];

  const brands = ["Sony", "Apple", "Samsung", "Bose", "JBL", "Apple", "Samsung", "Fitbit", "Garmin", "Dyson", "iRobot", "Shark", "Ninja", "Instant Pot", "KitchenAid"];

  productNames.forEach((name, idx) => {
    const basePrice = 29 + Math.random() * 400;
    const msrp = (basePrice * (1 + Math.random() * 0.2)).toFixed(2);
    const prices: USMerchantPrice[] = [
      {
        merchant: "Amazon.com",
        price: (basePrice + Math.random() * 15).toFixed(2),
        url: "#",
        inStock: Math.random() > 0.15,
        rating: 4.0 + Math.random(),
        lastUpdated: new Date(Date.now() - Math.random() * 86400000 * 2).toISOString(),
        primeEligible: Math.random() > 0.3,
      },
      {
        merchant: "Walmart",
        price: (basePrice - Math.random() * 10).toFixed(2),
        url: "#",
        inStock: Math.random() > 0.1,
        rating: 4.0 + Math.random(),
        lastUpdated: new Date(Date.now() - Math.random() * 86400000 * 2).toISOString(),
        storePickup: Math.random() > 0.4,
      },
      {
        merchant: "Target",
        price: (basePrice + Math.random() * 20).toFixed(2),
        url: "#",
        inStock: Math.random() > 0.12,
        rating: 4.0 + Math.random(),
        lastUpdated: new Date(Date.now() - Math.random() * 86400000 * 2).toISOString(),
        storePickup: Math.random() > 0.35,
      },
      {
        merchant: "Best Buy",
        price: (basePrice + Math.random() * 5).toFixed(2),
        url: "#",
        inStock: Math.random() > 0.08,
        rating: 4.0 + Math.random(),
        lastUpdated: new Date(Date.now() - Math.random() * 86400000 * 2).toISOString(),
      },
    ];

    products.push({
      id: `us-product-${idx}`,
      name,
      image: `https://picsum.photos/seed/us${idx}/400/400`,
      description: `Compare prices for ${name} across Amazon, Walmart, Target, and Best Buy.`,
      specs: {
        Brand: brands[idx],
        "Product Type": "Electronics",
        Rating: `${(4.0 + Math.random()).toFixed(1)} / 5`,
        Reviews: `${Math.floor(100 + Math.random() * 1000)}`,
      },
      prices: prices.sort((a, b) => {
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return parseFloat(a.price) - parseFloat(b.price);
      }),
      msrp,
      overallRating: 4.0 + Math.random(),
      reviewCount: Math.floor(100 + Math.random() * 1000),
      brand: brands[idx],
      sku: `SKU-US-${1000 + idx}`,
      asin: `B00${100000 + idx}`,
      walmartId: `WM${10000000 + idx}`,
      targetId: `TG${1000000 + idx}`,
      bestBuyId: `BBY${10000000 + idx}`,
      lastUpdated: new Date(Date.now() - Math.random() * 86400000 * 2).toISOString(),
    });
  });

  return products;
}

export interface USProductForSitemap {
  id: string;
  name: string;
  slug: string;
  lastUpdated: string;
}

interface GetUSProductsOptions {
  allowMockFallback?: boolean;
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
  const baseUrl = process.env.NEXT_PUBLIC_BUYWHERE_API_URL || "https://api.buywhere.ai";
  const apiKey = process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";
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

export async function getUSProducts(options: GetUSProductsOptions = {}): Promise<USProductForSitemap[]> {
  const { allowMockFallback = true } = options;
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
      .catch(() =>
        generateMockUSProducts().map((product) => ({
          id: product.id,
          name: product.name,
          slug: buildUSProductSlug(product),
          lastUpdated: product.lastUpdated || new Date().toISOString(),
        }))
      )
      .finally(() => {
        inflightUSProducts = null;
      });
  }

  try {
    return await inflightUSProducts;
  } catch {
    if (allowMockFallback) {
      return generateMockUSProducts().map((product) => ({
        id: product.id,
        name: product.name,
        slug: buildUSProductSlug(product),
        lastUpdated: product.lastUpdated || new Date().toISOString(),
      }));
    }

    throw new Error("Failed to load US products");
  }
}

export async function getAllUSProductIds(): Promise<string[]> {
  const products = await getUSProducts();
  return products.map((p) => p.id);
}
