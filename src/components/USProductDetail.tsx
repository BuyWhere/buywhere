"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { AffiliateLink } from "@/components/AffiliateLink";
import { CrossMarketWidget } from "@/components/ui/CrossMarketWidget";
import Link from "next/link";
import { useCompare } from "@/lib/compare-context";
import { useRecentlyViewed } from "@/lib/recently-viewed-context";
import { useWishlist } from "@/lib/wishlist-context";
import WishlistButton from "@/components/WishlistButton";

import { FreshnessBadge } from "@/components/ui/FreshnessBadge";
import { MerchantBadge } from "@/components/ui/MerchantBadge";
import { AffiliateDisclosure } from "@/components/ui/AffiliateDisclosure";
import { PriceAlertButton } from "@/components/PriceAlertButton";
import ShareDealActions from "@/components/share/ShareDealActions";
import { ProductBehaviorExplainer } from "@/components/ui/ProductBehaviorExplainer";
import { ReliabilityMetrics } from "@/components/ui/ReliabilityMetrics";
import { ScrapingVsBuyWhere } from "@/components/ui/ScrapingVsBuyWhere";

interface USMerchantPrice {
  merchant: string;
  price: string | null;
  url: string;
  inStock: boolean;
  rating?: number;
  lastUpdated: string;
  primeEligible?: boolean;
  storePickup?: boolean;
  price_missing_reason?: "not_found" | "retailer_unavailable" | "scraping_failed" | "product_discontinued";
}

interface USProduct {
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
  regions?: string[];
}

interface RelatedProduct {
  id: string;
  name: string;
  image: string;
  price: string | null;
  merchant: string;
}

interface PriceHistoryEntry {
  date: string;
  min_price: number;
  max_price: number;
  avg_price: number;
  price_count: number;
  currency: string;
  platform: string | null;
}

interface PriceHistoryResponse {
  product_id: number;
  entries: Array<{ price: number; currency: string; platform: string; scraped_at: string }>;
  aggregated_entries: PriceHistoryEntry[];
  total: number;
  aggregate: string | null;
  period: string | null;
}

interface ProductMatchResponse {
  id: number;
  name: string;
  price: number;
  currency: string;
  match_score: number;
}

interface ProductMatchesResponse {
  product_id: number;
  matches: ProductMatchResponse[];
  total: number;
}

interface RetailerReview {
  retailer: string;
  rating: number;
  review_count: number;
  review_url: string;
  last_review_date?: string;
}

interface ReviewSummary {
  product_id: number;
  product_name: string;
  overall_rating: number;
  total_reviews: number;
  retailer_reviews: RetailerReview[];
  summary: string;
  pros?: string[];
  cons?: string[];
  top_keywords: string[];
  last_updated: string;
}

interface PriceHistoryChartProps {
  history: PriceHistoryEntry[];
  currency: string;
}

function PriceHistoryChart({ history, currency }: PriceHistoryChartProps) {
  if (history.length === 0) return null;

  const sortedEntries = [...history].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const prices = sortedEntries.flatMap((e) => [e.min_price, e.max_price]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const width = 600;
  const height = 200;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const xScale = (i: number) => (i / (sortedEntries.length - 1 || 1)) * chartWidth;
  const yScale = (p: number) => chartHeight - ((p - minPrice) / (maxPrice - minPrice || 1)) * chartHeight;

  const pathD = sortedEntries
    .map((e, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(e.avg_price)}`)
    .join(" ");

  const areaD = `${pathD} L ${xScale(sortedEntries.length - 1)} ${chartHeight} L ${xScale(0)} ${chartHeight} Z`;

  const formatPrice = (p: number) => {
    const locale = currency === "USD" ? "en-US" : "en-SG";
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(p);
    const symbol = currency === "USD" ? "$" : currency;
    return `${symbol} ${formatted}`;
  };

  return (
    <div className="mt-8 pt-8 border-t border-gray-100" data-tour="price-history">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Price History (30 Days)</h3>
      <div className="bg-gray-50 rounded-xl p-4 overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[300px]" aria-label="Price history chart">
          <defs>
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <g transform={`translate(${padding.left}, ${padding.top})`}>
            {[minPrice, (minPrice + maxPrice) / 2, maxPrice].map((p, i) => (
              <g key={i}>
                <line x1={0} y1={yScale(p)} x2={chartWidth} y2={yScale(p)} stroke="#e5e7eb" strokeDasharray="4,4" />
                <text x={-8} y={yScale(p) + 4} textAnchor="end" fontSize={11} fill="#6b7280">{formatPrice(p)}</text>
              </g>
            ))}
            {sortedEntries
              .filter((_, i) => i % Math.ceil(sortedEntries.length / 6) === 0 || i === sortedEntries.length - 1)
              .map((e, i) => {
                const originalIndex = sortedEntries.indexOf(e);
                return (
                  <text key={i} x={xScale(originalIndex)} y={chartHeight + 20} textAnchor="middle" fontSize={10} fill="#6b7280">
                    {new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </text>
                );
              })}
            <path d={areaD} fill="url(#areaGradient)" />
            <path d={pathD} fill="none" stroke="#6366f1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {sortedEntries.map((e, i) => (
              <circle key={i} cx={xScale(i)} cy={yScale(e.avg_price)} r={3} fill="#6366f1" />
            ))}
          </g>
        </svg>
        <div className="flex justify-between mt-2 text-xs text-gray-500 px-4">
          <span>Low: {formatPrice(minPrice)}</span>
          <span>Current: {formatPrice(sortedEntries[sortedEntries.length - 1]?.avg_price || minPrice)}</span>
          <span>High: {formatPrice(maxPrice)}</span>
        </div>
      </div>
    </div>
  );
}

const MERCHANT_INFO: Record<string, { color: string; bgColor: string; accentColor: string; icon: string }> = {
  "Amazon.com": {
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    accentColor: "border-orange-200",
    icon: "📦",
  },
  Walmart: {
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    accentColor: "border-blue-200",
    icon: "🛒",
  },
  Target: {
    color: "text-red-600",
    bgColor: "bg-red-50",
    accentColor: "border-red-200",
    icon: "🎯",
  },
  "Best Buy": {
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    accentColor: "border-blue-300",
    icon: "🏪",
  },
};

function formatPrice(price: string | null, isZeroPrice?: boolean): string {
  if (price === null) return "—";
  if (isZeroPrice) return "FREE";
  const num = parseFloat(price);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `$${formatted}`;
}

function formatLastUpdated(lastUpdated: string): string {
  const timestamp = new Date(lastUpdated);
  if (Number.isNaN(timestamp.getTime())) {
    return "Update time unavailable";
  }

  const diffHours = Math.max(0, Math.round((Date.now() - timestamp.getTime()) / (1000 * 60 * 60)));
  if (diffHours < 1) {
    return "Updated within the last hour";
  }
  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) {
    return `Updated ${diffDays}d ago`;
  }

  return `Updated ${timestamp.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function USRetailerCard({
  price,
  productId,
  productName,
  isLowest,
  productInCompare,
  onToggleCompare,
}: {
  price: USMerchantPrice;
  productId: string;
  productName?: string;
  isLowest: boolean;
  productInCompare?: boolean;
  onToggleCompare?: () => void;
}) {
  const info = MERCHANT_INFO[price.merchant];

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-4 md:p-5 transition-all hover:shadow-lg ${
        isLowest
          ? `${info.bgColor} ${info.accentColor} shadow-sm`
          : "bg-white border-gray-100"
      }`}
    >
      {isLowest && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-3 py-1 bg-green-500 text-white text-xs font-bold rounded-full shadow-sm">
            LOWEST PRICE
          </span>
        </div>
      )}

      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden="true">{info.icon}</span>
          <MerchantBadge merchant={price.merchant} className="border border-white/70 shadow-sm" />
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">
          Trusted store
        </span>
      </div>

      {price.price === null ? (
        <div className="flex-1 flex flex-col items-center justify-center py-4 md:py-6">
          <span className="text-2xl text-gray-300 mb-2">—</span>
          <span className="text-sm text-gray-500 italic text-center">
            {price.price_missing_reason === "not_found"
              ? "Price not found"
              : price.price_missing_reason === "retailer_unavailable"
              ? "Retailer unavailable"
              : price.price_missing_reason === "scraping_failed"
              ? "Could not fetch price"
              : price.price_missing_reason === "product_discontinued"
              ? "Product discontinued"
              : "Price unavailable"}
          </span>
        </div>
      ) : (
        <div className="flex-1">
          <div className="text-2xl md:text-3xl font-bold text-gray-900 mb-1">
            {formatPrice(price.price)}
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
            <span
              className={`w-2 h-2 rounded-full ${
                price.inStock ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span>{price.inStock ? "In Stock" : "Out of Stock"}</span>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <FreshnessBadge lastUpdated={price.lastUpdated} className="rounded-md px-2 py-1" />
            <span className="text-xs text-gray-500">{formatLastUpdated(price.lastUpdated)}</span>
          </div>

          {price.merchant === "Amazon.com" && price.primeEligible && (
            <div className="flex items-center gap-1 text-xs text-orange-600 mb-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
              Prime Eligible
            </div>
          )}

          {price.merchant === "Walmart" && price.storePickup && (
            <div className="flex items-center gap-1 text-xs text-blue-600 mb-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Store Pickup Available
            </div>
          )}

          {price.merchant === "Target" && price.storePickup && (
            <div className="flex items-center gap-1 text-xs text-red-600 mb-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Order Pickup Available
            </div>
          )}

          {price.merchant === "Best Buy" && (
            <div className="flex items-center gap-1 text-xs text-blue-700 mb-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              Free Shipping on Orders $35+
            </div>
          )}

          {price.rating && (
            <div className="flex items-center gap-1 text-sm">
              <span className="text-yellow-500">★</span>
              <span className="font-medium text-gray-900">{price.rating.toFixed(1)}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {price.price !== null ? (
          <AffiliateLink
            productId={productId}
            platform={price.merchant.toLowerCase().replace(".", "")}
            productName={productName}
            href={price.url}
            className="block w-full text-center px-4 py-3 font-semibold rounded-xl transition-colors bg-indigo-600 text-white hover:bg-indigo-700"
          >
            View on {price.merchant}
          </AffiliateLink>
        ) : (
          <button
            disabled
            className="w-full px-4 py-3 font-semibold rounded-xl bg-gray-100 text-gray-400 cursor-not-allowed"
          >
            Unavailable
          </button>
        )}
        {onToggleCompare && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleCompare();
            }}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 font-medium rounded-lg text-sm transition-all min-h-[44px] touch-manipulation active:scale-95 ${
              productInCompare
                ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border border-indigo-200'
                : 'bg-gray-50 text-gray-700 hover:bg-indigo-100 hover:text-indigo-700 border border-gray-200 hover:border-indigo-200'
            }`}
          >
            <svg
              className="w-4 h-4"
              fill={productInCompare ? 'currentColor' : 'none'}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={productInCompare
                  ? "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                  : "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                }
              />
            </svg>
            {productInCompare ? 'In Compare' : 'Add to Compare'}
          </button>
        )}
        {price.price !== null && (
          <AffiliateDisclosure variant="inline" className="justify-center text-center text-[11px] text-gray-500" />
        )}
      </div>

      {price.price === null && (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-gray-500">
          <FreshnessBadge lastUpdated={price.lastUpdated} className="rounded-md px-2 py-1" />
          <span>{formatLastUpdated(price.lastUpdated)}</span>
        </div>
      )}
    </div>
  );
}

function SavingsCalculator({
  msrp,
  currentPrice,
  merchant,
}: {
  msrp: string;
  currentPrice: string;
  merchant: string;
}) {
  const msrpVal = parseFloat(msrp);
  const priceVal = parseFloat(currentPrice);
  const savings = msrpVal - priceVal;
  const savingsPercent = (savings / msrpVal) * 100;

  if (savings <= 0) return null;

  return (
    <div className="mt-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm text-indigo-800">
            Save <span className="font-semibold">${savings.toFixed(2)}</span> ({savingsPercent.toFixed(0)}% off MSRP)
          </span>
        </div>
        <span className="text-xs text-indigo-600">at {merchant}</span>
      </div>
    </div>
  );
}

function ReviewsSection({ summary }: { summary: ReviewSummary }) {
  const RETAILER_INFO: Record<string, { color: string; bgColor: string; icon: string }> = {
    "Amazon.com": { color: "text-orange-600", bgColor: "bg-orange-50", icon: "📦" },
    Walmart: { color: "text-blue-600", bgColor: "bg-blue-50", icon: "🛒" },
    Target: { color: "text-red-600", bgColor: "bg-red-50", icon: "🎯" },
    "Best Buy": { color: "text-blue-700", bgColor: "bg-blue-50", icon: "🏪" },
  };

  return (
    <div className="mt-8 pt-8 border-t border-gray-100">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">Review Summary</h3>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-6 border border-indigo-100">
          <div className="flex items-center gap-4 mb-4">
            <div className="text-5xl font-bold text-indigo-700">{summary.overall_rating.toFixed(1)}</div>
            <div>
              <div className="flex items-center gap-1 text-yellow-500">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i} className={i < Math.floor(summary.overall_rating) ? "text-yellow-400" : "text-gray-300"}>★</span>
                ))}
              </div>
              <p className="text-sm text-gray-600 mt-1">Based on {summary.total_reviews.toLocaleString()} reviews</p>
            </div>
          </div>

          <p className="text-gray-700 mb-4">{summary.summary}</p>

          {summary.top_keywords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {summary.top_keywords.map((keyword) => (
                <span key={keyword} className="px-2 py-1 bg-white text-xs font-medium text-indigo-600 rounded-full border border-indigo-100">
                  {keyword}
                </span>
              ))}
            </div>
          )}

          {(summary.pros?.length || summary.cons?.length) && (
            <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-indigo-100">
              {summary.pros && summary.pros.length > 0 && (
                <div>
                  <h5 className="text-sm font-semibold text-green-700 mb-2">Pros</h5>
                  <ul className="space-y-1">
                    {summary.pros.slice(0, 3).map((pro, i) => (
                      <li key={i} className="text-sm text-gray-600 flex items-start gap-1">
                        <span className="text-green-500">+</span> {pro}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {summary.cons && summary.cons.length > 0 && (
                <div>
                  <h5 className="text-sm font-semibold text-red-700 mb-2">Cons</h5>
                  <ul className="space-y-1">
                    {summary.cons.slice(0, 3).map((con, i) => (
                      <li key={i} className="text-sm text-gray-600 flex items-start gap-1">
                        <span className="text-red-500">−</span> {con}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-4">Reviews by Retailer</h4>
          <div className="space-y-3">
            {summary.retailer_reviews.map((retailer) => {
              const info = RETAILER_INFO[retailer.retailer] || { color: "text-gray-600", bgColor: "bg-gray-50", icon: "🏬" };
              return (
                <a
                  key={retailer.retailer}
                  href={retailer.review_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-between p-4 rounded-xl ${info.bgColor} border border-gray-100 hover:shadow-md transition-shadow`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{info.icon}</span>
                    <div>
                      <span className={`font-semibold ${info.color}`}>{retailer.retailer}</span>
                      <p className="text-xs text-gray-500">{retailer.review_count.toLocaleString()} reviews</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-gray-900">{retailer.rating.toFixed(1)}</span>
                    <span className="text-yellow-500">★</span>
                  </div>
                </a>
              );
            })}
          </div>

          <p className="text-xs text-gray-400 mt-4 text-center">
            Last updated: {new Date(summary.last_updated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </div>
    </div>
  );
}

function generateMockUSProducts(): USProduct[] {
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
      regions: ["US", "SG", "SEA"].filter(() => Math.random() > 0.3),
    });
  });

  return products;
}

function generateMockReviewSummary(productName: string): ReviewSummary {
  const retailers = ["Amazon.com", "Walmart", "Target", "Best Buy"];
  const retailerReviews: RetailerReview[] = retailers.map((retailer) => ({
    retailer,
    rating: 3.5 + Math.random() * 1.5,
    review_count: Math.floor(50 + Math.random() * 500),
    review_url: "#",
    last_review_date: new Date(Date.now() - Math.random() * 86400000 * 30).toISOString(),
  }));

  const totalReviews = retailerReviews.reduce((sum, r) => sum + r.review_count, 0);
  const weightedRating = retailerReviews.reduce((sum, r) => sum + r.rating * r.review_count, 0) / totalReviews;

  return {
    product_id: 0,
    product_name: productName,
    overall_rating: Math.round(weightedRating * 10) / 10,
    total_reviews: totalReviews,
    retailer_reviews: retailerReviews,
    summary: `Customers praise the ${productName} for its build quality and value proposition. Common positive themes include reliable performance and competitive pricing across retailers.`,
    pros: ["Great value for money", "Reliable performance", "Wide availability"],
    cons: ["Mixed availability", "Price varies by retailer"],
    top_keywords: ["value", "quality", "performance", "price"],
    last_updated: new Date().toISOString(),
  };
}

interface USProductDetailProps {
  productId: string;
}

function ProductLoadingSkeleton() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />
      <section className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900 text-white py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="h-4 bg-indigo-500/30 rounded w-32 w-48 mb-4 animate-pulse" />
          <div className="h-8 bg-indigo-500/30 rounded w-3/4 mb-2 animate-pulse" />
          <div className="h-4 bg-indigo-500/30 rounded w-1/2 animate-pulse" />
        </div>
      </section>
      <section className="py-12 bg-gray-50 flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-6">
              <div className="flex flex-col md:flex-row gap-8">
                <div className="w-full md:w-64 h-64 bg-gray-200 rounded-xl animate-pulse" />
                <div className="flex-1">
                  <div className="h-6 bg-gray-200 rounded w-1/4 mb-4 animate-pulse" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="h-48 bg-gray-200 rounded-xl animate-pulse" />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}

function ProductErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />
      <div className="flex-1 flex flex-col items-center justify-center py-16 px-4">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
          <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Unable to load product</h2>
        <p className="text-gray-500 mb-6 text-center max-w-md">
          We encountered an issue while fetching product data. Please check your connection and try again.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Try again
          </button>
          <Link
            href="/compare/us"
            className="px-6 py-3 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
          >
            Browse Products
          </Link>
        </div>
      </div>
      <Footer />
    </div>
  );
}

function ProductNotFoundState() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />
      <div className="flex-1 flex flex-col items-center justify-center py-16 px-4">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Product not found</h2>
        <p className="text-gray-500 mb-8 text-center">
          The product you&apos;re looking for doesn&apos;t exist or has been removed.
        </p>
        <Link
          href="/compare/us"
          className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
        >
          Browse US Products
        </Link>
      </div>
      <Footer />
    </div>
  );
}

export default function USProductDetail({ productId }: USProductDetailProps) {
  const [product, setProduct] = useState<USProduct | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([]);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<RelatedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const numericProductId = parseInt(productId.replace(/[^0-9]/g, ""), 10) || 1;

  const { addToCompare, removeFromCompare, isInCompare, compareCount } = useCompare();
  const { addToRecentlyViewed, recentlyViewed } = useRecentlyViewed();
  const { isInWishlist, updateWishlistItem } = useWishlist();
  const inCompare = product ? isInCompare(product.id) : false;
  const availablePrices = product?.prices.filter((p) => p.price !== null) ?? [];
  const verifiedRetailerCount = product?.prices.filter((price) => MERCHANT_INFO[price.merchant]).length ?? 0;
  const lowestPrice = availablePrices.length > 0
    ? availablePrices.reduce((min, p) => {
        const minVal = parseFloat(min.price!);
        const pVal = parseFloat(p.price!);
        return pVal < minVal ? p : min;
      })
    : null;

  const handleToggleCompare = () => {
    if (!product) return;
    if (inCompare) {
      removeFromCompare(product.id);
    } else {
      addToCompare({
        id: product.id,
        name: product.name,
        image: product.image,
        prices: product.prices.map(p => ({
          merchant: p.merchant,
          price: p.price,
          url: p.url,
        })),
        lowestPrice: lowestPrice?.price || null,
      });
    }
  };

  const fetchProductAndHistory = async () => {
    setLoading(true);
    setError(false);
    setNotFound(false);
    const baseUrl = process.env.NEXT_PUBLIC_BUYWHERE_API_URL || "https://api.buywhere.ai";
    const apiKey = process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";

    try {
      const [historyRes, matchesRes, reviewsRes] = await Promise.all([
        fetch(`${baseUrl}/v1/products/${numericProductId}/price-history?days=30&aggregate=daily`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
        fetch(`${baseUrl}/v1/products/${numericProductId}/matches`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
        fetch(`${baseUrl}/v1/products/${numericProductId}/reviews/summary?country=US`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      ]);

      let historyData: PriceHistoryEntry[] = [];
      if (historyRes.ok) {
        const historyJson: PriceHistoryResponse = await historyRes.json();
        historyData = historyJson.aggregated_entries || [];
        setPriceHistory(historyData);
      }

      if (reviewsRes.ok) {
        const reviewsJson: ReviewSummary = await reviewsRes.json();
        setReviewSummary(reviewsJson);
      }

      if (matchesRes.ok) {
        const matchesJson: ProductMatchesResponse = await matchesRes.json();
        if (matchesJson.matches && matchesJson.matches.length > 0) {
          const apiMatch = matchesJson.matches[0];
          const priceEntries: USMerchantPrice[] = matchesJson.matches.slice(0, 4).map((m, idx) => ({
            merchant: ["Amazon.com", "Walmart", "Target", "Best Buy"][idx] || `Retailer ${idx}`,
            price: m.price.toString(),
            url: "#",
            inStock: true,
            lastUpdated: new Date().toISOString(),
          }));

          setProduct({
            id: productId,
            name: apiMatch.name,
            image: `https://picsum.photos/seed/${productId}/400/400`,
            description: `Compare prices for ${apiMatch.name} across top US retailers.`,
            specs: { Brand: "Various", "Match Score": `${(apiMatch.match_score * 100).toFixed(0)}%` },
            prices: priceEntries,
            overallRating: 4.2,
            reviewCount: 256,
            brand: "Various",
            sku: `SKU-${productId}`,
          });
          setNotFound(false);
          setLoading(false);
          return;
        }
      }
    } catch {
      setError(true);
      setLoading(false);
      return;
    }

    const mockProducts = generateMockUSProducts();
    const foundProduct = mockProducts.find((p) => p.id === productId);
    if (foundProduct) {
      setProduct(foundProduct);
      setReviewSummary(generateMockReviewSummary(foundProduct.name));
      const otherProducts = mockProducts.filter((p) => p.id !== productId).slice(0, 4);
      setRelatedProducts(
        otherProducts.map((p) => ({
          id: p.id,
          name: p.name,
          image: p.image,
          price: p.prices[0]?.price || null,
          merchant: p.prices[0]?.merchant || "Various",
        }))
      );
      setNotFound(false);
    } else {
      setNotFound(true);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchProductAndHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, numericProductId]);

  useEffect(() => {
    if (product) {
      const availablePrices = product.prices.filter((p) => p.price !== null);
      const lowest = availablePrices.length > 0
        ? availablePrices.reduce((min, p) => {
            const minVal = parseFloat(min.price!);
            const pVal = parseFloat(p.price!);
            return pVal < minVal ? p : min;
          })
        : null;
      if (lowest) {
        addToRecentlyViewed({
          id: product.id,
          name: product.name,
          image: product.image,
          price: lowest.price,
          merchant: lowest.merchant,
          url: `/compare/us/${product.id}`,
        });
      }
    }
  }, [product, addToRecentlyViewed]);

  useEffect(() => {
    if (!product || !lowestPrice || !isInWishlist(product.id)) {
      return;
    }

    updateWishlistItem(product.id, {
      name: product.name,
      image: product.image,
      currentPrice: lowestPrice.price,
      merchant: lowestPrice.merchant,
      buyUrl: lowestPrice.url,
      productUrl: `/products/us/${product.id}`,
      brand: product.brand,
      apiProductId: numericProductId,
    });
  }, [isInWishlist, lowestPrice, numericProductId, product, updateWishlistItem]);

  if (loading) {
    return <ProductLoadingSkeleton />;
  }

  if (error) {
    return <ProductErrorState onRetry={fetchProductAndHistory} />;
  }

  if (notFound || !product) {
    return <ProductNotFoundState />;
  }

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.image,
    brand: {
      "@type": "Brand",
      name: product.brand,
    },
    aggregateRating: product.overallRating > 0 ? {
      "@type": "AggregateRating",
      ratingValue: product.overallRating.toFixed(1),
      reviewCount: product.reviewCount,
    } : undefined,
    offers: product.prices
      .filter((p) => p.price !== null)
      .map((p) => ({
        "@type": "Offer",
        price: p.price,
        priceCurrency: "USD",
        availability: p.inStock
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
        seller: {
          "@type": "Organization",
          name: p.merchant,
        },
      })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
      <div className="flex flex-col min-h-screen">
        <Nav />

      <section className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900 text-white py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <Link href="/compare/us" className="inline-flex items-center text-indigo-200 hover:text-white mb-4">
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to US Products
          </Link>
          <div className="flex items-center gap-2 mb-2">
            {(product.regions || ["US"]).map((region) => (
              <span
                key={region}
                className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  region === "US"
                    ? "bg-blue-500/30 text-blue-200"
                    : region === "SG"
                    ? "bg-red-500/30 text-red-200"
                    : region === "SEA"
                    ? "bg-amber-500/30 text-amber-200"
                    : "bg-indigo-500/30 text-indigo-200"
                }`}
              >
                {region === "US" ? "🇺🇸 United States" : region === "SG" ? "🇸🇬 Singapore" : region === "SEA" ? "🌏 Southeast Asia" : region}
              </span>
            ))}
            <span className="text-indigo-200 text-sm">{product.brand}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{product.name}</h1>
          <div className="flex items-center gap-4 text-sm text-indigo-200">
            <div className="flex items-center gap-1">
              <span className="text-yellow-400">★</span>
              <span>{product.overallRating.toFixed(1)}</span>
            </div>
            <span>{product.reviewCount} reviews</span>
          </div>
            <div className="flex items-center gap-3 mt-4">
              {lowestPrice ? (
                <WishlistButton
                  variant="pill"
                  product={{
                    id: product.id,
                    name: product.name,
                    image: product.image,
                    currentPrice: lowestPrice.price,
                    merchant: lowestPrice.merchant,
                    buyUrl: lowestPrice.url,
                    productUrl: `/products/us/${product.id}`,
                    brand: product.brand,
                    apiProductId: numericProductId,
                  }}
                />
              ) : null}
              <PriceAlertButton
                productId={numericProductId}
                productName={product.name}
                productImageUrl={product.image}
                productUrl={typeof window === "undefined" ? undefined : window.location.href}
                currentLowestPrice={lowestPrice?.price?.toString() || ""}
                currency="USD"
                className="flex-1 bg-indigo-50 px-4 py-3 rounded-lg text-center border border-indigo-200"
              />
            </div>
            <div className="mt-5 max-w-3xl rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
              <ShareDealActions
                productId={numericProductId}
                productName={product.name}
                productUrl={`/products/us/${product.id}`}
                merchant={lowestPrice?.merchant || null}
                priceText={lowestPrice ? formatPrice(lowestPrice.price) : null}
                variant="menu"
              />
            </div>
        </div>
      </section>

      <section className="py-12 bg-gray-50 flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-6">
              <div className="flex flex-col md:flex-row gap-8">
                <div className="relative w-full md:w-64 h-64 bg-gray-100 rounded-xl overflow-hidden">
                  <Image
                    src={product.image}
                    alt={product.name}
                    fill
                    className="object-cover rounded-xl"
                    sizes="(max-width: 768px) 100vw, 256px"
                  />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Price Comparison</h2>
                  <div className="mb-5 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
                      <svg className="h-3.5 w-3.5 text-slate-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      {verifiedRetailerCount} verified retailers
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                      <svg className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3a1 1 0 102 0V7zm-1 7a1.25 1.25 0 100-2.5A1.25 1.25 0 0010 14z" clipRule="evenodd" />
                      </svg>
                      Freshness shown on every offer
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
                      <svg className="h-3.5 w-3.5 text-amber-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M18 10A8 8 0 112 10a8 8 0 0116 0zm-7-4a1 1 0 10-2 0v4a1 1 0 102 0V6zm-1 8a1.25 1.25 0 100-2.5A1.25 1.25 0 0010 14z" clipRule="evenodd" />
                      </svg>
                      Affiliate links disclosed before click-through
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {product.prices.map((price) => (
                      <USRetailerCard
                        key={price.merchant}
                        price={price}
                        productId={product.id}
                        productName={product.name}
                        isLowest={lowestPrice?.merchant === price.merchant}
                        productInCompare={inCompare}
                        onToggleCompare={handleToggleCompare}
                      />
                    ))}
                  </div>

                  {availablePrices.length > 1 && lowestPrice && (
                    <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-green-800">
                          Save{" "}
                          <span className="font-semibold">
                            $
                            {(
                              parseFloat(
                                availablePrices
                                  .filter((p) => p.price !== null)
                                  .reduce((max, p) =>
                                    parseFloat(p.price!) > parseFloat(max.price!) ? p : max
                                  ).price!
                              ) - parseFloat(lowestPrice.price!)
                            ).toFixed(2)}
                          </span>{" "}
                          by buying from {lowestPrice.merchant}
                        </span>
                        <span className="text-sm font-semibold text-green-700">Best Deal</span>
                      </div>
                    </div>
                  )}

                  {product.msrp && lowestPrice && (
                    <SavingsCalculator
                      msrp={product.msrp}
                      currentPrice={lowestPrice.price!}
                      merchant={lowestPrice.merchant}
                    />
                  )}
                </div>
              </div>

              <div className="mt-8 pt-8 border-t border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Product Specifications</h3>
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(product.specs).map(([key, value]) => (
                    <div key={key} className="flex justify-between py-2 border-b border-gray-50">
                      <span className="text-gray-500">{key}</span>
                      <span className="text-gray-900 font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {priceHistory.length > 0 && (
                <PriceHistoryChart history={priceHistory} currency="USD" />
              )}

              {reviewSummary && <ReviewsSection summary={reviewSummary} />}

              <CrossMarketWidget
                productName={product.name}
                currentMarket="US"
              />

              <div className="mt-8 pt-8 border-t border-gray-100">
                <ProductBehaviorExplainer productName={product.name} />
              </div>

              <div className="mt-8 pt-8 border-t border-gray-100">
                <ReliabilityMetrics />
              </div>

              <div className="mt-8 pt-8 border-t border-gray-100">
                <ScrapingVsBuyWhere />
              </div>

              <div className="mt-8 pt-8 border-t border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Product Details</h3>
                <p className="text-gray-600">{product.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="text-sm text-gray-500">SKU: {product.sku}</span>
                  {product.asin && <span className="text-sm text-gray-500">ASIN: {product.asin}</span>}
                </div>
              </div>

              {recentlyViewed.filter(r => r.id !== product?.id).length > 0 && (
                <div className="mt-8 pt-8 border-t border-gray-100">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Recently Viewed</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {recentlyViewed
                      .filter(r => r.id !== product?.id)
                      .slice(0, 4)
                      .map((recent) => (
                        <Link
                          key={recent.id}
                          href={recent.url}
                          className="group block bg-gray-50 rounded-xl p-3 hover:bg-gray-100 transition-colors"
                        >
                          <div className="relative w-full aspect-square bg-white rounded-lg overflow-hidden mb-3">
                            <Image
                              src={recent.image}
                              alt={recent.name}
                              fill
                              className="object-cover group-hover:scale-105 transition-transform"
                              sizes="(max-width: 768px) 50vw, 25vw"
                            />
                          </div>
                          <h4 className="text-sm font-medium text-gray-900 line-clamp-2 mb-1 group-hover:text-indigo-600 transition-colors">
                            {recent.name}
                          </h4>
                          <div className="flex items-center justify-between">
                            {recent.price && (
                              <span className="text-sm font-semibold text-gray-900">
                                ${parseFloat(recent.price).toFixed(2)}
                              </span>
                            )}
                            <span className="text-xs text-gray-500">{recent.merchant}</span>
                          </div>
                        </Link>
                      ))}
                  </div>
                </div>
              )}

              {relatedProducts.length > 0 && (
                <div className="mt-8 pt-8 border-t border-gray-100">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Related Products</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {relatedProducts.map((related) => (
                      <Link
                        key={related.id}
                        href={`/compare/us/${related.id}`}
                        className="group block bg-gray-50 rounded-xl p-3 hover:bg-gray-100 transition-colors"
                      >
                        <div className="relative w-full aspect-square bg-white rounded-lg overflow-hidden mb-3">
                          <Image
                            src={related.image}
                            alt={related.name}
                            fill
                            className="object-cover group-hover:scale-105 transition-transform"
                            sizes="(max-width: 768px) 50vw, 25vw"
                          />
                        </div>
                        <h4 className="text-sm font-medium text-gray-900 line-clamp-2 mb-1 group-hover:text-indigo-600 transition-colors">
                          {related.name}
                        </h4>
                        <div className="flex items-center justify-between">
                          {related.price && (
                            <span className="text-sm font-semibold text-gray-900">
                              ${parseFloat(related.price).toFixed(2)}
                            </span>
                          )}
                          <span className="text-xs text-gray-500">{related.merchant}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <Footer />

      {compareCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg md:hidden">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="flex -space-x-2">
                  {[...Array(Math.min(compareCount, 3))].map((_, i) => (
                    <div
                      key={i}
                      className="w-8 h-8 rounded-full bg-indigo-100 border-2 border-white flex items-center justify-center text-xs font-semibold text-indigo-600"
                    >
                      {i + 1}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <span className="font-semibold text-gray-900">{compareCount}</span>
                <span className="text-gray-500 text-sm ml-1">
                  {compareCount === 1 ? 'product' : 'products'} in compare
                </span>
              </div>
            </div>
            <Link
              href="/compare/us"
              className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors active:scale-95 min-h-[44px] flex items-center"
            >
              Compare Now
            </Link>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
