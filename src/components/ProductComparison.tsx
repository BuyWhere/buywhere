"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PlatformComparisonBadge from "@/components/PlatformComparisonBadge";
import { AsyncSurfaceState } from "@/components/ui/AsyncSurfaceState";
import { FreshnessBadge } from "@/components/ui/FreshnessBadge";
import { getFreshnessTier, type DataFreshness } from "@/lib/freshness";
import editorialContent from "../../content/compare/editorial-content.json";
import { PRODUCT_TAXONOMY } from "@/lib/taxonomy";

type Region = "SG" | "US" | "BOTH";
type PriceMissingReason = "not_found" | "retailer_unavailable" | "scraping_failed" | "product_discontinued";

interface MerchantPrice {
  merchant: string;
  price: string | null;
  url: string;
  inStock: boolean;
  rating?: number;
  lastUpdated: string;
  price_missing_reason?: PriceMissingReason;
}

interface ProductCoverage {
  total_retailers: number;
  available_retailers: number;
  unavailable_retailers: string[];
  data_freshness: DataFreshness;
  zero_price: boolean;
}

interface Product {
  id: string;
  name: string;
  image: string;
  description: string;
  specs: Record<string, string>;
  prices: MerchantPrice[];
  overallRating: number;
  reviewCount: number;
  brand: string;
  sku: string;
  coverage?: ProductCoverage;
}

interface ComparisonCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
}

interface EditorialSummary {
  title: string;
  body: string;
}

interface EditorialFaq {
  question: string;
  answer: string;
}

interface CategoryEditorialContent {
  expertSummaries: EditorialSummary[];
  faqs: EditorialFaq[];
}

const categories: ComparisonCategory[] = PRODUCT_TAXONOMY.map((cat) => ({
  id: cat.id,
  name: cat.name,
  slug: cat.slug,
  description: cat.description,
  icon: cat.icon,
}));

const compareEditorialContent = editorialContent as Record<string, CategoryEditorialContent>;

function SparseStateIndicator({ coverage, retailerCount }: { coverage?: ProductCoverage; retailerCount: number }) {
  if (!coverage) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {retailerCount === 1 && (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium rounded-full">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Single retailer
        </span>
      )}
      {retailerCount === 2 && (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium rounded-full">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Limited coverage
        </span>
      )}
      {coverage.unavailable_retailers.length > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 border border-gray-200 text-gray-600 text-xs font-medium rounded-full">
          {coverage.unavailable_retailers.length} retailers unavailable
        </span>
      )}
      <FreshnessBadge freshness={coverage.data_freshness} />
    </div>
  );
}

function PriceDisplay({ price, reason, isZeroPrice }: { price: string | null; reason?: PriceMissingReason; isZeroPrice?: boolean }) {
  if (price === null) {
    const reasonLabels: Record<PriceMissingReason, string> = {
      not_found: "Price not found",
      retailer_unavailable: "Retailer unavailable",
      scraping_failed: "Could not fetch price",
      product_discontinued: "Product discontinued",
    };
    return (
      <div className="flex flex-col gap-1">
        <span className="text-lg font-semibold text-gray-400">—</span>
        {reason && (
          <span className="text-xs text-gray-500 italic">{reasonLabels[reason]}</span>
        )}
      </div>
    );
  }

  if (isZeroPrice) {
    return <span className="text-lg font-bold text-green-600">FREE</span>;
  }

  return <span className="text-lg font-bold text-indigo-600">{price}</span>;
}

function getCoverageScore(coverage: ProductCoverage): { score: number; label: string; color: string } {
  const { available_retailers, total_retailers, data_freshness } = coverage;
  const retailerScore = total_retailers > 0 ? (available_retailers / total_retailers) * 100 : 0;
  const freshnessScore = data_freshness === "fresh" ? 100 : data_freshness === "recent" ? 75 : data_freshness === "stale" ? 40 : 15;
  const score = Math.round((retailerScore * 0.6 + freshnessScore * 0.4));

  if (score >= 80) return { score, label: "High coverage", color: "text-green-600" };
  if (score >= 50) return { score, label: "Medium coverage", color: "text-yellow-600" };
  return { score, label: "Low coverage", color: "text-red-600" };
}

function generateMockProducts(category: string, region: Region = "SG"): Product[] {
  const products: Product[] = [];
  const productNames: Record<string, string[]> = {
    electronics: [
      "Sony WH-1000XM5 Wireless Headphones",
      "Apple AirPods Pro 2nd Gen",
      "Samsung Galaxy Buds2 Pro",
      "Bose QuietComfort 45",
      "JBL Tune 770NC Headphones",
    ],
    fashion: [
      "Nike Air Max 270 Sneakers",
      "Adidas Originals Trefoil Hoodie",
      "Uniqlo Ultra Light Down Jacket",
      "Zara High Waist Wide Leg Trousers",
      "H&M Cotton Cardigan",
    ],
    home: [
      "IKEA KALLAX Shelf Unit",
      "Philips Hue Smart Bulb Starter Kit",
      " Tefal Jamie Oliver Cookware Set",
      "Dyson V15 Detect Vacuum",
      "雀巢 Dolce Gusto Coffee Machine",
    ],
    beauty: [
      "SK-II Facial Treatment Essence",
      "La Mer Moisturizing Cream",
      "Shiseido Ultimune Power Cream",
      "Kiehl's Calendula Serum",
      "Estee Lauder Advanced Night Repair",
    ],
    sports: [
      "Nike Metcon 9 Training Shoes",
      "Adidas Powerlifting Shoes",
      "Under Armour HeatGear Shorts",
      "Garmin Forerunner 265 Watch",
      "Theragun Mini Massager",
    ],
    health: [
      "Blackmores Complete Multi Vitamins",
      "Swisse Ultiboost Calcium + Vitamin D",
      "Centrum Silver Adults 50+",
      "Nature's Way Selenium Supplement",
      "Bioglan Melatonin 1mg",
    ],
    toys: [
      "LEGO Star Wars Millennium Falcon",
      "PlayStation 5 DualSense Controller",
      "Nintendo Switch OLED",
      "Mattel UNO Card Game",
      "Hot Wheels 50 Car Gift Pack",
    ],
    food: [
      "Godiva Chocolate Gift Box",
      "TWG Tea Advent Calendar",
      "Harrolds Fine Foods Truffle Oil",
      "Whittard of Chelsea Hot Chocolate",
      "Fortnum & Mason Biscuit Collection",
    ],
    automotive: [
      "3M Car Phone Mount",
      "Xiaomi 70mai Dash Cam",
      "Turtle Wax Hybrid Ceramic Spray",
      "Autoglym Bodywork Polish Kit",
      "Bosch Spark Plugs Iridium",
    ],
    pets: [
      "Royal Canin Adult Dog Food",
      "Hill's Science Diet Cat Food",
      "KONG Classic Dog Toy",
      "Feliway Classic Plug-in Diffuser",
      "Bravecto Flea & Tick Treatment",
    ],
  };

  const names = productNames[category] || productNames.electronics;
  const sgMerchants = ["Shopee", "Lazada", "Amazon.sg", "Carousell", "Qoo10"];
  const usMerchants = ["Amazon.com", "Walmart", "Target", "Best Buy"];
  const merchants = region === "US" ? usMerchants : region === "BOTH" ? [...sgMerchants, ...usMerchants] : sgMerchants;

  names.forEach((name, idx) => {
    const defaultCurrencyPrefix = region === "US" ? "$" : "S$";
    const prices: MerchantPrice[] = merchants.slice(0, 3 + Math.floor(Math.random() * 3)).map((merchant) => {
      const isUSMerchant = usMerchants.includes(merchant);
      const currencyPrefix = isUSMerchant ? "$" : "S$";
      return {
        merchant,
        price: `${currencyPrefix}${(20 + Math.random() * 500).toFixed(2)}`,
        url: "#",
        inStock: Math.random() > 0.2,
        rating: 3.5 + Math.random() * 1.5,
        lastUpdated: new Date(Date.now() - Math.random() * 86400000 * 3).toISOString(),
      };
    });

    const lastUpdated = new Date(Date.now() - Math.random() * 86400000 * 3).toISOString();
    const availableCount = prices.filter(p => p.price !== null).length;
    const unavailableMerchants = merchants.slice(prices.length);

    const coverage: ProductCoverage = {
      total_retailers: merchants.length,
      available_retailers: availableCount,
      unavailable_retailers: unavailableMerchants,
      data_freshness: getFreshnessTier(lastUpdated),
      zero_price: prices.some(p => p.price === `${defaultCurrencyPrefix}0.00`),
    };

    products.push({
      id: `${category}-${idx}`,
      name,
      image: `https://picsum.photos/seed/${category}${idx}/400/400`,
      description: `High-quality ${name.toLowerCase()} available from multiple retailers across supported markets.`,
      specs: {
        Brand: ["Sony", "Apple", "Samsung", "Nike", "Adidas"][idx % 5],
        "Product Type": category === "electronics" ? "Audio" : category === "fashion" ? "Footwear" : "General",
        Rating: `${(3.5 + Math.random()).toFixed(1)} / 5`,
        Reviews: `${Math.floor(50 + Math.random() * 500)}`,
      },
      prices: prices.sort((a, b) => {
        const aPrice = a.price ? parseFloat(a.price.replace(/[S$]/g, "")) : Infinity;
        const bPrice = b.price ? parseFloat(b.price.replace(/[S$]/g, "")) : Infinity;
        return aPrice - bPrice;
      }),
      overallRating: 3.5 + Math.random() * 1.5,
      reviewCount: Math.floor(50 + Math.random() * 500),
      brand: ["Sony", "Apple", "Samsung", "Nike", "Adidas"][idx % 5],
      sku: `SKU-${category.toUpperCase()}-${1000 + idx}`,
      coverage,
    });
  });

  return products;
}

function ProductCard({ product, isMobile }: { product: Product; isMobile?: boolean }) {
  const retailerCount = product.prices.length;
  const hasPrices = product.prices.some(p => p.price !== null);
  const bestPrice = hasPrices ? product.prices.find(p => p.price !== null) : null;
  const [selectedMerchant, setSelectedMerchant] = useState(bestPrice || product.prices[0]);
  const [showAllPrices, setShowAllPrices] = useState(false);

  const coverage = product.coverage;
  const coverageInfo = coverage ? getCoverageScore(coverage) : null;

  const isSparseState = retailerCount <= 2;
  const isSingleRetailer = retailerCount === 1;

  if (isMobile) {
    return (
      <div className={`bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow overflow-hidden ${isSparseState ? "border-amber-200" : "border-gray-100"}`}>
        <div className="flex p-3 gap-3">
          <Image
            src={product.image}
            alt={product.name}
            width={80}
            height={80}
            className="object-cover rounded-lg bg-gray-100 flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm mb-1 line-clamp-2">{product.name}</h3>
            <div className="flex items-center gap-1 mb-1">
              <span className="text-yellow-500 text-xs">★</span>
              <span className="text-xs font-medium text-gray-900">{product.overallRating.toFixed(1)}</span>
              <span className="text-xs text-gray-500">({product.reviewCount})</span>
            </div>
            {bestPrice && (
              <div className="flex items-center gap-2">
                <PriceDisplay
                  price={bestPrice.price}
                  reason={bestPrice.price_missing_reason}
                  isZeroPrice={coverage?.zero_price}
                />
                <span className="text-xs text-gray-500">{bestPrice.merchant}</span>
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-gray-100 p-3">
          <Link
            href={selectedMerchant.url}
            className="block w-full text-center px-3 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
          >
            View on {selectedMerchant.merchant}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-2xl border shadow-sm hover:shadow-md transition-shadow overflow-hidden ${isSparseState ? "border-amber-200" : "border-gray-100"}`}>
      <div className="p-4">
        <SparseStateIndicator coverage={coverage} retailerCount={retailerCount} />
        <div className="relative w-full h-48 mb-4 bg-gray-100 rounded-xl overflow-hidden">
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="object-cover rounded-xl"
            sizes="(max-width: 768px) 100vw, 500px"
          />
        </div>
        <h3 className="font-semibold text-gray-900 text-sm mb-2 line-clamp-2">{product.name}</h3>
        {product.description && (
          <p className="text-sm text-gray-600 mb-3 line-clamp-3">{product.description}</p>
        )}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-yellow-500">★</span>
          <span className="text-sm font-medium text-gray-900">{product.overallRating.toFixed(1)}</span>
          <span className="text-sm text-gray-500">({product.reviewCount} reviews)</span>
        </div>
        <PlatformComparisonBadge
          productQuery={product.name}
          maxPlatforms={isSingleRetailer ? 1 : 3}
          className="mt-2"
        />
        {coverageInfo && (
          <div className={`text-xs ${coverageInfo.color} mt-2 font-medium`}>
            {coverageInfo.label} ({coverageInfo.score}%)
          </div>
        )}
      </div>

      <div className="border-t border-gray-100">
        {isSingleRetailer ? (
          <div className="p-4 bg-amber-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-amber-800">Only Available From</span>
            </div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-amber-700">{selectedMerchant.merchant}</span>
              <PriceDisplay
                price={selectedMerchant.price}
                reason={selectedMerchant.price_missing_reason}
                isZeroPrice={coverage?.zero_price}
              />
            </div>
            <div className="flex items-center gap-2 mb-4">
              <span className={`w-2 h-2 rounded-full ${selectedMerchant.inStock ? "bg-green-500" : "bg-red-500"}`}></span>
              <span className="text-sm text-gray-600">{selectedMerchant.inStock ? "In Stock" : "Out of Stock"}</span>
            </div>
            <div className="text-xs text-amber-700 italic mb-3">
              Limited comparison data — only one retailer available
            </div>
            <Link
              href={selectedMerchant.url}
              className="block w-full text-center px-4 py-3 bg-amber-600 text-white font-semibold rounded-xl hover:bg-amber-700 transition-colors"
            >
              View on {selectedMerchant.merchant}
            </Link>
          </div>
        ) : retailerCount === 2 ? (
          <div className="p-4 bg-blue-50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">Compare</span>
              {coverageInfo && (
                <span className={`text-xs font-medium ${coverageInfo.color}`}>
                  {coverageInfo.score}% coverage
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {product.prices.map((price, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border ${
                    selectedMerchant.merchant === price.merchant
                      ? "bg-white border-indigo-300"
                      : "bg-gray-50 border-gray-200 hover:border-gray-300"
                  } cursor-pointer transition-colors`}
                  onClick={() => setSelectedMerchant(price)}
                >
                  <div className="text-xs text-gray-500 mb-1">{price.merchant}</div>
                  <PriceDisplay
                    price={price.price}
                    reason={price.price_missing_reason}
                    isZeroPrice={coverage?.zero_price && idx === 0}
                  />
                  <div className="flex items-center gap-1 mt-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${price.inStock ? "bg-green-500" : "bg-red-500"}`}></span>
                    <span className="text-xs text-gray-500">{price.inStock ? "Available" : "Out"}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-xs text-blue-700 italic mb-3">
              Only 2 retailers — comparison limited
            </div>
            <Link
              href={selectedMerchant.url}
              className="block w-full text-center px-4 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
            >
              View on {selectedMerchant.merchant}
            </Link>
          </div>
        ) : (
          <div className="p-4 bg-gray-50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">Best Price</span>
              <PriceDisplay
                price={bestPrice?.price || null}
                reason={bestPrice?.price_missing_reason}
                isZeroPrice={coverage?.zero_price}
              />
            </div>
            <div className="flex items-center gap-2 mb-4">
              <span className={`w-2 h-2 rounded-full ${bestPrice?.inStock ? "bg-green-500" : "bg-red-500"}`}></span>
              <span className="text-sm text-gray-600">{bestPrice?.inStock ? "In Stock" : "Out of Stock"}</span>
              <span className="text-sm text-gray-400">·</span>
              <span className="text-sm text-gray-600">{bestPrice?.merchant}</span>
            </div>
          </div>
        )}

        {!isSingleRetailer && (
          <div className="p-4">
            <button
              onClick={() => setShowAllPrices(!showAllPrices)}
              className="w-full text-sm text-indigo-600 font-medium hover:text-indigo-700 mb-3"
            >
              {showAllPrices ? "Hide" : "Show"} all {product.prices.length} prices
            </button>

            {showAllPrices && (
              <div className="space-y-2 mb-4">
                {product.prices.map((price, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                      selectedMerchant.merchant === price.merchant
                        ? "bg-indigo-50 border border-indigo-200"
                        : "bg-gray-50 hover:bg-gray-100"
                    }`}
                    onClick={() => setSelectedMerchant(price)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{price.merchant}</span>
                      {!price.inStock && (
                        <span className="text-xs text-red-500">(Out of Stock)</span>
                      )}
                      {price.price === null && (
                        <span className="text-xs text-gray-400 italic">(unavailable)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <PriceDisplay
                        price={price.price}
                        reason={price.price_missing_reason}
                        isZeroPrice={false}
                      />
                      {idx === 0 && price.price !== null && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                          Best
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {bestPrice && (
              <Link
                href={selectedMerchant.url}
                className="block w-full text-center px-4 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
              >
                View on {selectedMerchant.merchant}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ComparisonErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <AsyncSurfaceState
      tone="error"
      eyebrow="Comparison unavailable"
      title="Retailer coverage could not be loaded"
      description="We couldn’t assemble this category comparison from the latest retailer feeds. Retry to request fresh data, or switch regions if one market is temporarily lagging."
      meta="This state appears before any category products are rendered."
      primaryAction={
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
        >
          Retry comparison
        </button>
      }
      secondaryAction={
        <a
          href="/compare"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900"
        >
          Choose another category
        </a>
      }
      compact
    />
  );
}

function ComparisonEmptyState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <AsyncSurfaceState
      tone="empty"
      eyebrow="No filtered matches"
      title="No products match the current comparison filters"
      description="The selected product type removed every item from this category view. Reset the filter to restore the full comparison table and coverage insights."
      primaryAction={
        <button
          onClick={onClearFilters}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          Clear filters
        </button>
      }
      compact
    />
  );
}

function CategoryFilterSidebar({
  productTypes,
  selectedType,
  onSelectType,
}: {
  productTypes: string[];
  selectedType: string | null;
  onSelectType: (type: string | null) => void;
}) {
  return (
    <aside className="w-64 flex-shrink-0">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sticky top-4">
        <h3 className="font-semibold text-gray-900 mb-3">Filter by Type</h3>
        <ul className="space-y-1">
          <li>
            <button
              onClick={() => onSelectType(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedType === null
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              All Products
            </button>
          </li>
          {productTypes.map((type) => (
            <li key={type}>
              <button
                onClick={() => onSelectType(type)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedType === type
                    ? "bg-indigo-100 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {type}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function ComparisonTable({ products }: { products: Product[] }) {
  const [sortBy, setSortBy] = useState<"price" | "rating" | "coverage">("price");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const sortedProducts = [...products].sort((a, b) => {
    const aPrice = a.prices[0]?.price ? parseFloat(a.prices[0].price.replace(/[S$]/g, "")) : Infinity;
    const bPrice = b.prices[0]?.price ? parseFloat(b.prices[0].price.replace(/[S$]/g, "")) : Infinity;
    const aRating = a.overallRating;
    const bRating = b.overallRating;
    const aCoverage = a.coverage ? getCoverageScore(a.coverage).score : 100;
    const bCoverage = b.coverage ? getCoverageScore(b.coverage).score : 100;

    if (sortBy === "price") {
      return sortOrder === "asc" ? aPrice - bPrice : bPrice - aPrice;
    }
    if (sortBy === "coverage") {
      return sortOrder === "asc" ? aCoverage - bCoverage : bCoverage - aCoverage;
    }
    return sortOrder === "asc" ? aRating - bRating : bRating - aRating;
  });

  const sparseProducts = products.filter(p => p.prices.length <= 2);
  const coverageSummary = {
    high: products.filter(p => p.coverage && getCoverageScore(p.coverage).score >= 80).length,
    medium: products.filter(p => p.coverage && getCoverageScore(p.coverage).score >= 50 && getCoverageScore(p.coverage).score < 80).length,
    low: products.filter(p => p.coverage && getCoverageScore(p.coverage).score < 50).length,
  };

  return (
    <div className="overflow-x-auto">
      {sparseProducts.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="font-medium">{sparseProducts.length} products have limited retailer coverage (1-2 retailers)</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 mb-4">
        <span className="text-sm font-medium text-gray-700">Sort by:</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "price" | "rating" | "coverage")}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="price">Price</option>
          <option value="rating">Rating</option>
          <option value="coverage">Coverage</option>
        </select>
        <button
          onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
          className="text-sm text-indigo-600 font-medium hover:text-indigo-700"
        >
          {sortOrder === "asc" ? "↑ Low to High" : "↓ High to Low"}
        </button>

        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span className="text-gray-600">High ({coverageSummary.high})</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
            <span className="text-gray-600">Medium ({coverageSummary.medium})</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
            <span className="text-gray-600">Low ({coverageSummary.low})</span>
          </span>
        </div>
      </div>

      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-3 px-3 md:px-4 font-semibold text-gray-900 text-sm">Product</th>
            <th className="text-center py-3 px-3 md:px-4 font-semibold text-gray-900 text-sm hidden md:table-cell">Coverage</th>
            <th className="text-center py-3 px-3 md:px-4 font-semibold text-gray-900 text-sm">Lowest Price</th>
            <th className="text-center py-3 px-3 md:px-4 font-semibold text-gray-900 text-sm hidden md:table-cell">All Prices</th>
            <th className="text-center py-3 px-3 md:px-4 font-semibold text-gray-900 text-sm">Rating</th>
            <th className="text-center py-3 px-3 md:px-4 font-semibold text-gray-900 text-sm hidden lg:table-cell">Merchant</th>
          </tr>
        </thead>
        <tbody>
          {sortedProducts.map((product) => {
            const coverageInfo = product.coverage ? getCoverageScore(product.coverage) : null;
            const isSparse = product.prices.length <= 2;
            return (
              <tr key={product.id} className={`border-b border-gray-100 hover:bg-gray-50 ${isSparse ? "bg-amber-50/30" : ""}`}>
                <td className="py-3 px-3 md:py-4 md:px-4">
                  <div className="flex items-center gap-2 md:gap-3">
                    <Image
                      src={product.image}
                      alt={product.name}
                      width={64}
                      height={64}
                      className="object-cover rounded-lg bg-gray-100 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-xs md:text-sm line-clamp-2">{product.name}</p>
                      <p className="text-xs text-gray-500 hidden md:block">{product.brand}</p>
                      {isSparse && (
                        <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">
                          Limited
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="text-center py-3 px-3 md:py-4 md:px-4 hidden md:table-cell">
                  {coverageInfo ? (
                    <div className="flex flex-col items-center gap-1">
                      <span className={`text-xs md:text-sm font-bold ${coverageInfo.color}`}>{coverageInfo.score}%</span>
                      <div className="w-12 md:w-full h-1 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${coverageInfo.score >= 80 ? "bg-green-500" : coverageInfo.score >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                          style={{ width: `${coverageInfo.score}%` }}
                        ></div>
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </td>
                <td className="text-center py-3 px-3 md:py-4 md:px-4">
                  <div className="flex flex-col items-center gap-1">
                    <PriceDisplay
                      price={product.prices[0]?.price || null}
                      reason={product.prices[0]?.price_missing_reason}
                      isZeroPrice={product.coverage?.zero_price}
                    />
                    {product.prices[0]?.price !== null && (
                      <span className="text-xs text-green-600 font-medium">Best value</span>
                    )}
                  </div>
                </td>
                <td className="text-center py-3 px-3 md:py-4 md:px-4 hidden md:table-cell">
                  <div className="flex flex-wrap justify-center gap-1 max-w-[120px] mx-auto">
                    {product.prices.slice(0, 3).map((price, idx) => (
                      <span
                        key={idx}
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          price.price === null ? "bg-gray-100 text-gray-400 italic" : "bg-gray-100 text-gray-900"
                        }`}
                      >
                        {price.price || "—"}
                      </span>
                    ))}
                    {product.prices.length > 3 && (
                      <span className="text-xs text-gray-500">+{product.prices.length - 3}</span>
                    )}
                  </div>
                </td>
                <td className="text-center py-3 px-3 md:py-4 md:px-4">
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-yellow-500 text-xs md:text-sm">★</span>
                    <span className="font-medium text-gray-900 text-xs md:text-sm">{product.overallRating.toFixed(1)}</span>
                  </div>
                </td>
                <td className="text-center py-3 px-3 md:py-4 md:px-4 hidden lg:table-cell">
                  <span className="text-xs md:text-sm text-gray-600">{product.prices[0]?.merchant || "—"}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProductComparisonClient({
  category,
}: {
  category: ComparisonCategory;
}) {
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [region, setRegion] = useState<Region>("SG");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedProductType, setSelectedProductType] = useState<string | null>(null);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const categoryEditorial =
    compareEditorialContent[category.slug] ?? compareEditorialContent.electronics;

  const productTypes = Array.from(
    new Set(products.map((p) => p.specs?.["Product Type"]).filter(Boolean))
  ) as string[];

  const filteredProducts = selectedProductType
    ? products.filter((p) => p.specs?.["Product Type"] === selectedProductType)
    : products;

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const apiRegion = region === "BOTH" ? undefined : region === "US" ? "us" : "sea";
      const apiCountry = region === "US" ? "US" : region === "BOTH" ? undefined : "SG";
      const params = new URLSearchParams();
      if (apiRegion) params.set('region', apiRegion);
      if (apiCountry) params.set('country', apiCountry);
      const queryStr = params.toString();
      const baseUrl = process.env.NEXT_PUBLIC_BUYWHERE_API_URL || 'https://api.buywhere.ai';
      const response = await fetch(
        `${baseUrl}/v1/compare/${category.slug}${queryStr ? `?${queryStr}` : ''}`,
        { headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || ""}` } }
      );
      if (!response.ok) throw new Error("API error");
      const data = await response.json();
      const adaptedProducts: Product[] = data.products.map((p: { id: number; name: string; brand: string; sku: string; prices: { merchant: string; price: string; url: string; in_stock: boolean; rating?: number; last_updated: string }[] }) => ({
        id: String(p.id),
        name: p.name,
        image: `https://picsum.photos/seed/${p.id}/400/400`,
        description: `Compare prices for ${p.name} across multiple retailers.`,
        specs: { Brand: p.brand, SKU: p.sku },
        prices: p.prices.map((mp) => ({
          merchant: mp.merchant,
          price: mp.price,
          url: mp.url,
          inStock: mp.in_stock,
          rating: mp.rating,
          lastUpdated: mp.last_updated,
        })),
        overallRating: 4.0,
        reviewCount: 100,
        brand: p.brand,
        sku: p.sku,
      }));
      setProducts(adaptedProducts);
    } catch {
      setError(true);
      setProducts(generateMockProducts(category.slug, region));
    } finally {
      setLoading(false);
    }
  }, [category.slug, region]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const regionLabel = region === "BOTH" ? "SG + US" : region === "US" ? "United States" : "Singapore";
  const schemaMarkup = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ItemPage",
        name: `Compare ${category.name} Prices - ${regionLabel}`,
        description: category.description,
        mainEntity: {
          "@type": "Offer",
          category: category.name,
          seller: {
            "@type": "Organization",
            name: "BuyWhere",
          },
          availability: region === "US" ? "https://schema.org/InStock" : undefined,
          areaServed: region === "US"
            ? { "@type": "Country", name: "United States" }
            : region === "BOTH"
            ? [{ "@type": "Country", name: "Singapore" }, { "@type": "Country", name: "United States" }]
            : { "@type": "Country", name: "Singapore" },
        },
      },
      ...(region !== "SG" ? [{
        "@type": "ItemPage",
        name: `Compare ${category.name} Prices in United States`,
        description: `Find the best ${category.name.toLowerCase()} deals from Amazon.com, Walmart, Target, and Best Buy.`,
        mainEntity: {
          "@type": "Offer",
          category: category.name,
          seller: { "@type": "Organization", name: "BuyWhere" },
          availability: "https://schema.org/InStock",
          areaServed: { "@type": "Country", name: "United States" },
          priceCurrency: "USD",
        },
      }] : []),
      {
        "@type": "FAQPage",
        mainEntity: categoryEditorial.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer,
          },
        })),
      },
    ],
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Nav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaMarkup) }}
      />

      <section className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900 text-white py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-4xl">{category.icon}</span>
            <span className="text-indigo-200 text-sm font-medium">{category.name}</span>
            <span className="px-2 py-0.5 bg-indigo-500/30 text-indigo-200 text-xs font-medium rounded-full">
              {regionLabel}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-4">
            Compare {category.name} Prices by Market
          </h1>
          <p className="text-indigo-200 text-lg max-w-2xl">{category.description}</p>
        </div>
      </section>

      <section className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <span className="font-medium">{filteredProducts.length} products</span>
              <span>·</span>
              {(() => {
                const allMerchants = new Set<string>();
                const avgCoverage = products.reduce((sum, p) => {
                  if (p.coverage) {
                    allMerchants.add(`available(${p.coverage.available_retailers}/${p.coverage.total_retailers})`);
                    p.coverage.unavailable_retailers.forEach(u => allMerchants.add(`unavailable(${u})`));
                  }
                  return sum + (p.coverage ? getCoverageScore(p.coverage).score : 100);
                }, 0) / products.length;
                const avgCoverageColor = avgCoverage >= 80 ? "text-green-600" : avgCoverage >= 50 ? "text-yellow-600" : "text-red-600";
                return (
                  <>
                    <span>compared across</span>
                    <span className={`font-medium ${avgCoverageColor}`}>{Math.round(avgCoverage)}% avg coverage</span>
                    <span className="text-gray-400">|</span>
                    <span className="text-gray-500">{products.filter(p => p.prices.length <= 2).length} limited</span>
                  </>
                );
              })()}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Region:</span>
              <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                {(["SG", "US", "BOTH"] as Region[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRegion(r)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      region === r
                        ? "bg-white text-indigo-700 shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {r === "BOTH" ? "SG + US" : r}
                  </button>
                ))}
              </div>
              <span className="text-gray-400">|</span>
              <button
                onClick={() => setShowMobileSidebar(!showMobileSidebar)}
                className={`lg:hidden px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  showMobileSidebar
                    ? "bg-indigo-100 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                Filter {selectedProductType ? `(1)` : ""}
              </button>
              <span className="hidden lg:inline text-sm text-gray-600">View:</span>
              <button
                onClick={() => setViewMode("grid")}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  viewMode === "grid"
                    ? "bg-indigo-100 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                Grid
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  viewMode === "table"
                    ? "bg-indigo-100 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                Table
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="py-12 bg-gray-50 flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          {showMobileSidebar && (
            <div className="fixed inset-0 z-50 lg:hidden">
              <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileSidebar(false)} />
              <div className="absolute right-0 top-0 h-full w-72 bg-white shadow-xl p-4 overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-gray-900">Filter by Type</h3>
                  <button
                    onClick={() => setShowMobileSidebar(false)}
                    className="p-2 text-gray-500 hover:text-gray-700"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <CategoryFilterSidebar
                  productTypes={productTypes}
                  selectedType={selectedProductType}
                  onSelectType={(type) => {
                    setSelectedProductType(type);
                    setShowMobileSidebar(false);
                  }}
                />
              </div>
            </div>
          )}
          <div className="flex gap-8">
            <div className="hidden lg:block">
              <CategoryFilterSidebar
                productTypes={productTypes}
                selectedType={selectedProductType}
                onSelectType={setSelectedProductType}
              />
            </div>
            <div className="flex-1 min-w-0">
              {loading ? (
                <AsyncSurfaceState
                  tone="loading"
                  eyebrow={`${category.name} comparison`}
                  title={`Preparing ${category.name.toLowerCase()} price coverage`}
                  description={`We’re collecting retailer offers, freshness signals, and market coverage for ${regionLabel.toLowerCase()}.`}
                  meta="The comparison header and filters stay visible while the product grid hydrates."
                  compact
                >
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden="true">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm">
                        <div className="h-24 w-full animate-pulse rounded-xl bg-slate-200" />
                        <div className="mt-4 h-3 w-2/3 animate-pulse rounded-full bg-slate-200" />
                        <div className="mt-3 h-3 w-1/2 animate-pulse rounded-full bg-slate-100" />
                      </div>
                    ))}
                  </div>
                </AsyncSurfaceState>
              ) : error ? (
                <ComparisonErrorState onRetry={fetchProducts} />
              ) : filteredProducts.length === 0 ? (
                <ComparisonEmptyState onClearFilters={() => setSelectedProductType(null)} />
              ) : viewMode === "grid" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                  {filteredProducts.map((product) => (
                    <ProductCard key={product.id} product={product} isMobile={false} />
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                  <ComparisonTable products={filteredProducts} />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white py-16 border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl mb-10">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600 mb-3">
              Expert summaries
            </p>
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              How to compare {category.name.toLowerCase()} prices with more confidence
            </h2>
            <p className="text-base leading-relaxed text-gray-600">
              These editorial notes turn the raw price table into buying context for {category.name.toLowerCase()} shoppers.
              Use them to judge whether the lowest listing is actually the best option for your purchase.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {categoryEditorial.expertSummaries.map((summary) => (
              <article
                key={summary.title}
                className="rounded-3xl border border-gray-100 bg-gray-50 p-8 shadow-sm"
              >
                <h3 className="text-xl font-semibold text-gray-900 mb-3">{summary.title}</h3>
                <p className="text-sm leading-7 text-gray-600">{summary.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gray-50 py-16 border-t border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl mb-10">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600 mb-3">
              FAQ
            </p>
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Frequently asked questions about {category.name.toLowerCase()} price comparison
            </h2>
          </div>

          <div className="space-y-4">
            {categoryEditorial.faqs.map((faq) => (
              <article
                key={faq.question}
                className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
              >
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{faq.question}</h3>
                <p className="text-sm leading-7 text-gray-600">{faq.answer}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

export default function ProductComparisonPage({
  params,
}: {
  params: { category: string };
}) {
  const category = categories.find((c) => c.slug === params.category) || categories[0];

  return <ProductComparisonClient category={category} />;
}

export { categories };
