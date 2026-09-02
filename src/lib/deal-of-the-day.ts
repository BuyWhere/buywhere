const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
  "https://api.buywhere.ai";

const API_KEY = process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";

export interface FeaturedDeal {
  id: string;
  name: string;
  retailer: string;
  currentPrice: number;
  referencePrice: number | null;
  referenceLabel: string;
  savingsPct: number | null;
  savingsAmount: number | null;
  currency: string;
  imageUrl: string | null;
  destinationUrl: string;
  refreshAtIso: string;
  source: "today" | "deals-fallback";
}

function buildHeaders() {
  return API_KEY
    ? {
        Authorization: `Bearer ${API_KEY}`,
      }
    : undefined;
}

function getNextUtcMidnight(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  );
}

function getSecondsUntilNextUtcMidnight(now: Date = new Date()): number {
  const seconds = Math.ceil((getNextUtcMidnight(now).getTime() - now.getTime()) / 1000);
  return Math.max(seconds, 60);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(normalized) ? normalized : null;
  }

  return null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeFeaturedDeal(
  raw: Record<string, unknown>,
  source: FeaturedDeal["source"],
  refreshAtIso: string,
): FeaturedDeal | null {
  const id = raw.id ?? raw.product_id ?? raw.sku;
  const name = toStringValue(raw.name) ?? toStringValue(raw.title);
  const retailer = toStringValue(raw.retailer) ?? toStringValue(raw.merchant) ?? "Featured retailer";
  const currentPrice =
    toNumber(raw.current_price) ??
    toNumber(raw.price) ??
    toNumber(raw.sale_price);
  const averagePrice = toNumber(raw.average_price);
  const originalPrice = toNumber(raw.original_price);
  const referencePrice = averagePrice ?? originalPrice;
  const referenceLabel = averagePrice !== null ? "Average price" : "Previous price";
  const savingsPct =
    toNumber(raw.percent_below_average) ??
    toNumber(raw.discount_pct) ??
    toNumber(raw.drop_pct);
  const currency = toStringValue(raw.currency) ?? "USD";
  const imageUrl = toStringValue(raw.image_url);
  const destinationUrl =
    toStringValue(raw.affiliate_url) ??
    toStringValue(raw.buy_url) ??
    toStringValue(raw.url);

  if (!id || !name || currentPrice === null || !destinationUrl) {
    return null;
  }

  const normalizedReferencePrice =
    referencePrice !== null && referencePrice > currentPrice ? referencePrice : null;
  const savingsAmount =
    normalizedReferencePrice !== null ? normalizedReferencePrice - currentPrice : null;

  return {
    id: String(id),
    name,
    retailer,
    currentPrice,
    referencePrice: normalizedReferencePrice,
    referenceLabel,
    savingsPct,
    savingsAmount,
    currency,
    imageUrl,
    destinationUrl,
    refreshAtIso,
    source,
  };
}

async function fetchJson(url: string, revalidateSeconds: number) {
  const response = await fetch(url, {
    headers: buildHeaders(),
    next: { revalidate: revalidateSeconds },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json() as Promise<unknown>;
}

function pickTodayPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const deal = record.deal;
  const item = record.item;
  const data = record.data;

  if (deal && typeof deal === "object") return deal as Record<string, unknown>;
  if (item && typeof item === "object") return item as Record<string, unknown>;
  if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;

  return record;
}

function pickDealsFallbackPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items : Array.isArray(record.results) ? record.results : [];
  const bestItem = items[0];

  return bestItem && typeof bestItem === "object" ? (bestItem as Record<string, unknown>) : null;
}

export async function getFeaturedDealOfTheDay(): Promise<FeaturedDeal | null> {
  const now = new Date();
  const refreshAtIso = getNextUtcMidnight(now).toISOString();
  const revalidateSeconds = getSecondsUntilNextUtcMidnight(now);

  const todayUrls = [`${API_BASE_URL}/api/v1/deals/today`, `${API_BASE_URL}/v1/deals/today`];

  for (const url of todayUrls) {
    try {
      const payload = pickTodayPayload(await fetchJson(url, revalidateSeconds));
      const normalized = payload ? normalizeFeaturedDeal(payload, "today", refreshAtIso) : null;
      if (normalized) {
        return normalized;
      }
    } catch {
      // Fall through to the next candidate or the general deals endpoint.
    }
  }

  try {
    const params = new URLSearchParams({
      country: "US",
      period: "24h",
      limit: "1",
    });
    const payload = pickDealsFallbackPayload(await fetchJson(`${API_BASE_URL}/v1/deals?${params.toString()}`, revalidateSeconds));
    return payload ? normalizeFeaturedDeal(payload, "deals-fallback", refreshAtIso) : null;
  } catch {
    return null;
  }
}

export function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
