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

type SearchLikeMetadata = {
  availability?: string | null;
  stock_status?: string | null;
  in_stock?: boolean | null;
  available?: boolean | null;
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
  affiliate_redirect_url?: string | null;
  click_url?: string | null;
  affiliateLink?: string | null;
  brand?: string | null;
  category?: string | null;
  availability?: string | null;
  stock_status?: string | null;
  in_stock?: boolean | null;
  available?: boolean | null;
  metadata?: SearchLikeMetadata | null;
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

function normalizeAvailability(item: SearchLikeItem): Pick<ComparisonOffer, "availability" | "inStock"> {
  const inStock = item.in_stock ?? item.metadata?.in_stock;
  if (typeof inStock === "boolean") {
    return {
      availability: inStock ? "In stock" : "Out of stock",
      inStock,
    };
  }

  const available = item.available ?? item.metadata?.available;
  if (typeof available === "boolean") {
    return {
      availability: available ? "Available" : "Unavailable",
      inStock: available,
    };
  }

  const rawStatus = item.availability || item.stock_status || item.metadata?.availability || item.metadata?.stock_status;
  if (!rawStatus) {
    return { availability: "Availability unknown", inStock: null };
  }

  const normalized = rawStatus.trim().toLowerCase();
  if (normalized.includes("out") || normalized === "unavailable") {
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
    href: item.affiliate_redirect_url || item.click_url || item.affiliate_url || item.affiliateLink || item.buy_url || item.url || "#",
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
