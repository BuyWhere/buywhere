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
  price?: number | string | { amount?: number | string | null; currency?: string | null } | null;
  price_amount?: number | string | null;
  price_currency?: string | null;
  currency?: string | null;
  source?: string | null;
  merchant?: string | null;
  merchant_name?: string | null;
  image_url?: string | null;
  image?: string | null;
  url?: string | null;
  buy_url?: string | null;
  affiliate_url?: string | null;
  affiliate_redirect_url?: string | null;
  click_url?: string | null;
  affiliateLink?: string | null;
  brand?: string | null;
  category?: string | null;
  availability?: string | null;
  stock_status?: string | null;
  in_stock?: boolean | null;
  available?: boolean | null;
  metadata?: {
    availability?: string | null;
    in_stock?: boolean | null;
    category?: string | null;
    brand?: string | null;
  } | null;
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

function normalizeRetailerHref(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (!value) continue;

    const trimmed = value.trim();
    if (!trimmed || trimmed === "#") continue;

    try {
      const url = new URL(trimmed);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.toString();
      }
    } catch {
    }
  }

  return null;
}

export function hasRetailerHref(offer: Pick<ComparisonOffer, "href">): boolean {
  return normalizeRetailerHref(offer.href) !== null;
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

function normalizePriceFields(item: SearchLikeItem): { price: number | null; currency: string | null } {
  if (item.price && typeof item.price === "object") {
    return {
      price: normalizePrice(item.price.amount),
      currency: item.price.currency || null,
    };
  }

  return {
    price: normalizePrice(item.price_amount ?? item.price),
    currency: item.price_currency || item.currency || null,
  };
}

function normalizeAvailability(item: SearchLikeItem): Pick<ComparisonOffer, "availability" | "inStock"> {
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : null;

  if (typeof item.in_stock === "boolean") {
    return {
      availability: item.in_stock ? "In stock" : "Out of stock",
      inStock: item.in_stock,
    };
  }

  if (typeof metadata?.in_stock === "boolean") {
    return {
      availability: metadata.in_stock ? "In stock" : "Out of stock",
      inStock: metadata.in_stock,
    };
  }

  if (typeof item.available === "boolean") {
    return {
      availability: item.available ? "Available" : "Unavailable",
      inStock: item.available,
    };
  }

  const rawStatus = item.availability || item.stock_status || metadata?.availability;
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
  const priceFields = normalizePriceFields(item);

  return {
    id: String(item.id ?? item.name ?? item.title ?? crypto.randomUUID()),
    name: item.name || item.title || "Untitled product",
    merchant: formatMerchantName(item.merchant_name || item.merchant || item.source),
    price: priceFields.price,
    currency: priceFields.currency || fallbackCurrency,
    imageUrl: item.image_url || item.image || null,
    href: item.affiliate_redirect_url || item.click_url || item.affiliate_url || item.affiliateLink || item.buy_url || item.url || "#",
    availability: availability.availability,
    inStock: availability.inStock,
    brand: item.brand || item.metadata?.brand || null,
    category: item.category || item.metadata?.category || null,
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
