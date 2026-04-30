import { generateMockUSProducts } from "@/lib/us-products";

export type ComparisonOffer = {
  id: string;
  name: string;
  merchant: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  href: string;
  availability: string;
  inStock: boolean | null;
  brand: string | null;
  category: string | null;
  lastUpdated: string | null;
};

type SearchLikeItem = {
  id?: string | number | null;
  name?: string | null;
  title?: string | null;
  price?: number | string | null;
  currency?: string | null;
  source?: string | null;
  merchant?: string | null;
  image_url?: string | null;
  image?: string | null;
  url?: string | null;
  buy_url?: string | null;
  affiliate_url?: string | null;
  affiliateLink?: string | null;
  brand?: string | null;
  category?: string | null;
  availability?: string | null;
  stock_status?: string | null;
  in_stock?: boolean | null;
  available?: boolean | null;
  last_updated?: string | null;
  updated_at?: string | null;
};

export function parseIdsParam(ids?: string): string[] {
  if (!ids) return [];

  return ids
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function formatMerchantName(value?: string | null): string {
  if (!value) return "BuyWhere seller";

  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizePrice(price: number | string | null | undefined): number | null {
  if (typeof price === "number") {
    return Number.isFinite(price) ? price : null;
  }

  if (typeof price === "string" && price.trim()) {
    const parsed = Number(price);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeAvailability(item: SearchLikeItem): Pick<ComparisonOffer, "availability" | "inStock"> {
  if (typeof item.in_stock === "boolean") {
    return {
      availability: item.in_stock ? "In stock" : "Out of stock",
      inStock: item.in_stock,
    };
  }

  if (typeof item.available === "boolean") {
    return {
      availability: item.available ? "Available" : "Unavailable",
      inStock: item.available,
    };
  }

  const rawStatus = item.availability || item.stock_status;
  if (!rawStatus) {
    return { availability: "Availability unknown", inStock: null };
  }

  const normalized = rawStatus.trim().toLowerCase();
  if (normalized.includes("out")) {
    return { availability: "Out of stock", inStock: false };
  }

  if (normalized.includes("in") || normalized.includes("available")) {
    return { availability: "In stock", inStock: true };
  }

  return { availability: rawStatus, inStock: null };
}

export function normalizeComparisonOffer(
  item: SearchLikeItem,
  fallbackCurrency = "USD",
): ComparisonOffer {
  const availability = normalizeAvailability(item);

  return {
    id: String(item.id ?? item.name ?? item.title ?? crypto.randomUUID()),
    name: item.name || item.title || "Untitled product",
    merchant: formatMerchantName(item.merchant || item.source),
    price: normalizePrice(item.price),
    currency: item.currency || fallbackCurrency,
    imageUrl: item.image_url || item.image || null,
    href: item.affiliate_url || item.affiliateLink || item.buy_url || item.url || "#",
    availability: availability.availability,
    inStock: availability.inStock,
    brand: item.brand || null,
    category: item.category || null,
    lastUpdated: item.last_updated || item.updated_at || null,
  };
}

export function sortComparisonOffers(offers: ComparisonOffer[]): ComparisonOffer[] {
  return [...offers].sort((left, right) => {
    if (left.price === null && right.price === null) return left.merchant.localeCompare(right.merchant);
    if (left.price === null) return 1;
    if (right.price === null) return -1;
    if (left.price !== right.price) return left.price - right.price;
    return left.merchant.localeCompare(right.merchant);
  });
}

export function findBestOffer(offers: ComparisonOffer[]): ComparisonOffer | null {
  return sortComparisonOffers(offers).find((offer) => offer.price !== null) || null;
}

export function buildFallbackComparisonOffers(query?: string, ids: string[] = []): ComparisonOffer[] {
  const mockProducts = generateMockUSProducts();
  const normalizedQuery = query?.trim().toLowerCase() || "";

  let matchedProducts = mockProducts;

  if (ids.length > 0) {
    const idSet = new Set(ids);
    matchedProducts = mockProducts.filter((product) => idSet.has(product.id));
  } else if (normalizedQuery) {
    matchedProducts = mockProducts.filter((product) => {
      const haystack = [product.name, product.brand, product.description]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }

  const sourceProducts = matchedProducts.length > 0 ? matchedProducts : mockProducts.slice(0, 1);

  if (sourceProducts.length === 1) {
    const [product] = sourceProducts;
    return sortComparisonOffers(
      product.prices.map((price) => ({
        id: `${product.id}-${price.merchant}`,
        name: product.name,
        merchant: price.merchant,
        price: normalizePrice(price.price),
        currency: "USD",
        imageUrl: product.image,
        href: price.url || "#",
        availability: price.inStock ? "In stock" : "Out of stock",
        inStock: price.inStock,
        brand: product.brand,
        category: product.specs["Product Type"] || null,
        lastUpdated: price.lastUpdated || product.lastUpdated || null,
      })),
    );
  }

  return sortComparisonOffers(
    sourceProducts.slice(0, 6).map((product) => {
      const bestPrice = product.prices.find((price) => price.price !== null) || product.prices[0];
      return {
        id: product.id,
        name: product.name,
        merchant: bestPrice?.merchant || "BuyWhere seller",
        price: normalizePrice(bestPrice?.price),
        currency: "USD",
        imageUrl: product.image,
        href: bestPrice?.url || "#",
        availability: bestPrice?.inStock ? "In stock" : "Out of stock",
        inStock: bestPrice?.inStock ?? null,
        brand: product.brand,
        category: product.specs["Product Type"] || null,
        lastUpdated: bestPrice?.lastUpdated || product.lastUpdated || null,
      };
    }),
  );
}

export function formatOfferPrice(price: number | null, currency: string): string {
  if (price === null) return "Price unavailable";

  try {
    return new Intl.NumberFormat(currency === "SGD" ? "en-SG" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}
