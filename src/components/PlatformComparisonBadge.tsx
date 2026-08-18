"use client";

interface PlatformPrice {
  platform: string;
  price: string;
  currency: string;
  url: string;
  inStock: boolean;
  rating?: number;
  lastUpdated: string;
}

interface PlatformComparisonData {
  productName: string;
  productId?: string;
  prices: PlatformPrice[];
  lowestPrice: PlatformPrice;
  highestPrice: PlatformPrice;
  priceDiff: string;
}

interface PlatformComparisonBadgeProps {
  productQuery: string;
  productId?: string;
  maxPlatforms?: number;
  showPriceDiff?: boolean;
  onPlatformClick?: (platform: string, url: string) => void;
  className?: string;
  region?: "SG" | "US" | "BOTH";
  // BUY-60872 (governance rule #10): real retailer offers. When provided, the
  // badge renders these instead of synthesizing prices. When absent or empty,
  // the badge renders nothing — it never invents catalog data.
  prices?: Array<{
    platform: string;
    price: string | number | null;
    currency?: string;
    url?: string | null;
    inStock?: boolean;
  }>;
}

const PLATFORM_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Shopee: { bg: "bg-red-50", text: "text-red-600", border: "border-red-200" },
  Lazada: { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200" },
  "Amazon.sg": { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200" },
  "Amazon.com": { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200" },
  Carousell: { bg: "bg-green-50", text: "text-green-600", border: "border-green-200" },
  Qoo10: { bg: "bg-purple-50", text: "text-purple-600", border: "border-purple-200" },
  Walmart: { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200" },
  "Best Buy": { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200" },
  default: { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" },
};

function getPlatformStyle(platform: string) {
  return PLATFORM_COLORS[platform] || PLATFORM_COLORS.default;
}

const CURRENCY_LOCALE_MAP: Record<string, string> = {
  USD: "en-US",
  S$: "en-SG",
  A$: "en-AU",
  "£": "en-GB",
  "€": "de-DE",
};

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  USD: "$",
  S$: "S$",
  A$: "A$",
  "£": "£",
  "€": "€",
};

function getLocaleForCurrency(currency: string): string {
  return CURRENCY_LOCALE_MAP[currency] || "en-SG";
}

function getSymbolForCurrency(currency: string): string {
  return CURRENCY_SYMBOL_MAP[currency] || currency;
}

function formatPrice(price: string, currency: string = "S$"): string {
  const num = parseFloat(price);
  const locale = getLocaleForCurrency(currency);
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `${getSymbolForCurrency(currency)} ${formatted}`;
}

function PlatformBadge({
  platform,
  price,
  currency,
  inStock,
  url,
  onClick,
}: {
  platform: string;
  price: string;
  currency: string;
  inStock: boolean;
  url: string;
  onClick?: () => void;
}) {
  const style = getPlatformStyle(platform);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all hover:shadow-sm ${style.bg} ${style.text} ${style.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${inStock ? "bg-green-500" : "bg-red-400"}`} />
      <span>{platform}</span>
      <span className="font-semibold">{formatPrice(price, currency)}</span>
    </a>
  );
}

export default function PlatformComparisonBadge({
  productQuery,
  productId,
  maxPlatforms = 4,
  showPriceDiff = false,
  onPlatformClick,
  className = "",
  region = "SG",
  prices = [],
}: PlatformComparisonBadgeProps) {
  // BUY-60872 (governance rule #10): render nothing when no real prices are available.
  // We NEVER synthesize invented retailer prices — not even "nice" random ones.
  void productId;
  void productQuery;

  if (prices.length === 0) {
    return null;
  }

  const formattedPrices: PlatformPrice[] = prices
    .filter((p) => p.price !== null && p.price !== undefined)
    .sort((a, b) => {
      const aPrice = typeof a.price === 'number' ? a.price : parseFloat(String(a.price) || '0');
      const bPrice = typeof b.price === 'number' ? b.price : parseFloat(String(b.price) || '0');
      return aPrice - bPrice;
    })
    .map((p) => ({
      platform: p.platform,
      price: typeof p.price === 'number' ? p.price.toFixed(2) : String(p.price),
      currency: p.currency ?? (region === 'US' ? '$' : 'S$'),
      url: p.url ?? '#',
      inStock: p.inStock ?? true,
      rating: undefined,
      lastUpdated: new Date().toISOString(),
    }));

  if (formattedPrices.length === 0) {
    return null;
  }

  const displayedPlatforms = formattedPrices.slice(0, maxPlatforms);
  const remainingCount = formattedPrices.length - maxPlatforms;

  return (
    <div className={`inline-flex items-center flex-wrap gap-2 ${className}`}>
      <div className="flex items-center flex-wrap gap-2">
        {displayedPlatforms.map((item, index) => (
          <PlatformBadge
            key={`${item.platform}-${index}`}
            platform={item.platform}
            price={item.price}
            currency={item.currency}
            inStock={item.inStock}
            url={item.url}
            onClick={
              onPlatformClick
                ? () => onPlatformClick(item.platform, item.url)
                : undefined
            }
          />
        ))}
        {remainingCount > 0 && (
          <span className="text-xs text-gray-500 px-1">
            +{remainingCount} more
          </span>
        )}
      </div>
      {showPriceDiff && formattedPrices.length > 1 && (
        <span className="text-xs text-gray-400">
          (diff: {formatPrice(
            (parseFloat(formattedPrices[formattedPrices.length - 1].price) - parseFloat(formattedPrices[0].price)).toFixed(2),
            formattedPrices[0].currency,
          )})
        </span>
      )}
    </div>
  );
}

export type { PlatformComparisonData, PlatformPrice, PlatformComparisonBadgeProps };
