"use client";

import { useState, useEffect } from "react";

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

function PriceComparisonRowSkeleton() {
  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-6 w-28 bg-gray-200 rounded-full animate-pulse"
        />
      ))}
    </div>
  );
}

function generateMockComparison(
  productQuery: string,
  productId?: string,
  region: "SG" | "US" | "BOTH" = "SG"
): PlatformComparisonData {
  const sgMerchants = ["Shopee", "Lazada", "Amazon.sg", "Carousell", "Qoo10"];
  const usMerchants = ["Amazon.com", "Walmart", "Target", "Best Buy"];
  const merchants = region === "US" ? usMerchants : region === "BOTH" ? [...sgMerchants, ...usMerchants] : sgMerchants;

  const seed = `${productQuery}-${productId ?? "none"}`;
  const seedValue = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const platformCount = 2 + (seedValue % 4);
  const basePrice = 25 + (seedValue % 180);

  const prices: PlatformPrice[] = merchants.slice(0, platformCount).map((platform, index) => {
    const price = basePrice + index * 7 + ((seedValue + index) % 9);
    const isUSRegion = region === "US" || (region === "BOTH" && usMerchants.includes(platform));
    return {
      platform,
      price: price.toFixed(2),
      currency: isUSRegion ? "$" : "S$",
      url: "#",
      inStock: (seedValue + index) % 5 !== 0,
      rating: 3.8 + ((seedValue + index) % 12) / 10,
      lastUpdated: new Date(Date.now() - index * 3600_000).toISOString(),
    };
  });

  prices.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

  return {
    productName: productQuery,
    productId,
    prices,
    lowestPrice: prices[0],
    highestPrice: prices[prices.length - 1],
    priceDiff: (
      parseFloat(prices[prices.length - 1].price) - parseFloat(prices[0].price)
    ).toFixed(2),
  };
}

export default function PlatformComparisonBadge({
  productQuery,
  productId,
  maxPlatforms = 4,
  showPriceDiff = false,
  onPlatformClick,
  className = "",
  region = "SG",
}: PlatformComparisonBadgeProps) {
  const [data, setData] = useState<PlatformComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function load() {
      setLoading(true);
      setError(false);
      const result = generateMockComparison(productQuery, productId, region);

      if (!cancelled) {
        setData(result);
        setLoading(false);
      }
    }

    const timeoutId = window.setTimeout(load, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [productQuery, productId, region]);

  if (loading) {
    return (
      <div className={`inline-flex items-center ${className}`}>
        <PriceComparisonRowSkeleton />
      </div>
    );
  }

  if (error || !data || data.prices.length === 0) {
    return null;
  }

  const displayedPlatforms = data.prices.slice(0, maxPlatforms);
  const remainingCount = data.prices.length - maxPlatforms;

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
      {showPriceDiff && data.prices.length > 1 && (
        <span className="text-xs text-gray-400">
          (diff: {formatPrice(data.priceDiff)})
        </span>
      )}
    </div>
  );
}

export type { PlatformComparisonData, PlatformPrice, PlatformComparisonBadgeProps };
