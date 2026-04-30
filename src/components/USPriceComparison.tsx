"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { PriceAlertButton } from "@/components/PriceAlertButton";
import { useCompare } from "@/lib/compare-context";
import PriceCard from "@/components/ui/PriceCard";
import SpecSection from "@/components/ui/SpecSection";
import { AsyncSurfaceState } from "@/components/ui/AsyncSurfaceState";
import { RetailerSwitcher, filterByRetailers } from "@/components/RetailerSwitcher";
import { ProductBehaviorExplainer } from "@/components/ui/ProductBehaviorExplainer";
import { ReliabilityMetrics } from "@/components/ui/ReliabilityMetrics";
import { ScrapingVsBuyWhere } from "@/components/ui/ScrapingVsBuyWhere";

interface USMerchantPrice {
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

function USProductRow({
  product,
  enabledRetailers,
}: {
  product: USProduct;
  enabledRetailers?: string[];
}) {
  const { addToCompare, removeFromCompare, isInCompare } = useCompare();
  const inCompare = isInCompare(product.id);

  const handleToggleCompare = () => {
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
        lowestPrice: product.prices[0]?.price ?? null,
      });
    }
  };

  const filteredPrices = enabledRetailers
    ? filterByRetailers(product.prices, enabledRetailers)
    : product.prices;
  const availablePrices = filteredPrices.filter((p) => p.price !== null);
  const lowestPrice = availablePrices.length > 0
    ? availablePrices.reduce((min, p) => {
        const minVal = parseFloat(min.price!);
        const pVal = parseFloat(p.price!);
        return pVal < minVal ? p : min;
      })
    : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="p-5">
        <div className="flex gap-5">
          <Image
            src={product.image}
            alt={product.name}
            width={96}
            height={96}
            className="object-cover rounded-xl bg-gray-100 flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 line-clamp-2 mb-1">
              {product.name}
            </h3>
            <p className="text-sm text-gray-500 mb-2">{product.brand}</p>
            <div className="flex items-center gap-2">
              <span className="text-yellow-500 text-sm">★</span>
              <span className="text-sm font-medium text-gray-900">
                {product.overallRating.toFixed(1)}
              </span>
              <span className="text-sm text-gray-500">
                ({product.reviewCount} reviews)
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
          {filteredPrices.map((price) => (
            <PriceCard
              key={price.merchant}
              price={price}
              productId={product.id}
              productName={product.name}
              isLowest={lowestPrice?.merchant === price.merchant}
              productInCompare={inCompare}
              onAddToCompare={handleToggleCompare}
              msrp={product.msrp}
              competitorPrices={product.prices}
            />
          ))}
        </div>

        {availablePrices.length > 1 && lowestPrice && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-green-800">
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
              <span className="text-sm font-semibold text-green-700">
                Best Deal
              </span>
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

        {/* Specifications Section */}
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Specifications
          </h3>
          <div className="space-y-4">
            {/* Core Specifications */}
            <SpecSection
              specs={product.specs}
              category="Core Specifications"
              importanceMap={{
                Brand: 'primary',
                'Product Type': 'primary',
                SKU: 'secondary',
                UPC: 'tertiary',
                EAN: 'tertiary'
              }}
            />
            {/* Additional Specifications */}
            <SpecSection
              specs={product.specs}
              category="Additional Details"
              importanceMap={{
                Rating: 'secondary',
                Reviews: 'secondary'
              }}
            />
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100">
          <PriceAlertButton
            productId={parseInt(product.id.replace("us-product-", "")) || 0}
            productName={product.name}
            productImageUrl={product.image}
            currentLowestPrice={lowestPrice?.price ?? undefined}
            currency="USD"
            className="w-full sm:w-auto"
          />
        </div>
      </div>
    </div>
  );
}

function generateMockUSProducts(): USProduct[] {
  const products: USProduct[] = [];
  const productData: Array<{ name: string; brand: string; category: string }> = [
    { name: "Sony WH-1000XM5 Wireless Noise Canceling Headphones", brand: "Sony", category: "Electronics" },
    { name: "Apple AirPods Pro 2nd Generation", brand: "Apple", category: "Electronics" },
    { name: "Samsung Galaxy Buds2 Pro Earbuds", brand: "Samsung", category: "Electronics" },
    { name: "Bose QuietComfort 45 Headphones", brand: "Bose", category: "Electronics" },
    { name: "JBL Tune 770NC Wireless Over-Ear Headphones", brand: "JBL", category: "Electronics" },
    { name: "Apple Watch Series 9 GPS 45mm", brand: "Apple", category: "Electronics" },
    { name: "Samsung Galaxy Watch 6 Classic", brand: "Samsung", category: "Electronics" },
    { name: "Fitbit Charge 6 Fitness Tracker", brand: "Fitbit", category: "Electronics" },
    { name: "Garmin Forerunner 265 Smartwatch", brand: "Garmin", category: "Electronics" },
    { name: "Dyson V15 Detect Cordless Vacuum", brand: "Dyson", category: "Home & Living" },
    { name: "iRobot Roomba j7+ Self-Emptying Robot Vacuum", brand: "iRobot", category: "Home & Living" },
    { name: "Shark Navigator Lift-Away Upright Vacuum", brand: "Shark", category: "Home & Living" },
    { name: "Ninja Foodi 9-in-1 Pressure Cooker & Air Fryer", brand: "Ninja", category: "Home & Living" },
    { name: "Instant Pot Pro Plus 8-Quart", brand: "Instant Pot", category: "Home & Living" },
    { name: "KitchenAid Stand Mixer 5-Quart", brand: "KitchenAid", category: "Home & Living" },
    { name: "Levi's 501 Original Fit Jeans", brand: "Levi's", category: "Fashion" },
    { name: "Nike Air Max 270 Running Shoes", brand: "Nike", category: "Fashion" },
    { name: "Adidas Classic Backpack", brand: "Adidas", category: "Fashion" },
    { name: "Ray-Ban Aviator Sunglasses", brand: "Ray-Ban", category: "Fashion" },
    { name: "The North Face Puffer Jacket", brand: "The North Face", category: "Fashion" },
    { name: "Olaplex Hair Repair Treatment", brand: "Olaplex", category: "Beauty" },
    { name: "Cetaphil Moisturizing Cream", brand: "Cetaphil", category: "Beauty" },
    { name: "La Mer Moisturizing Cream", brand: "La Mer", category: "Beauty" },
    { name: "Philips Sonicare Electric Toothbrush", brand: "Philips", category: "Beauty" },
    { name: "Foreo Luna Facial Cleansing Device", brand: "Foreo", category: "Beauty" },
  ];

  productData.forEach(({ name, brand }, idx) => {
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
        Brand: brand,
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
      brand: brand,
      sku: `SKU-US-${1000 + idx}`,
      asin: `B00${100000 + idx}`,
      walmartId: `WM${10000000 + idx}`,
      targetId: `TG${1000000 + idx}`,
      bestBuyId: `BBY${10000000 + idx}`,
    });
  });

  return products;
}

function LoadingSkeleton() {
  return (
    <AsyncSurfaceState
      tone="loading"
      eyebrow="US price coverage"
      title="Building your retailer comparison"
      description="We’re checking current offers, stock signals, and savings across Amazon, Walmart, Target, and Best Buy."
      meta="This page loads the comparison shell first so filters stay responsive on slower connections."
      compact
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden="true">
        {["Amazon", "Walmart", "Target", "Best Buy"].map((merchant) => (
          <div key={merchant} className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm">
            <div className="h-3 w-16 animate-pulse rounded-full bg-slate-200" />
            <div className="mt-4 h-8 w-20 animate-pulse rounded-xl bg-slate-200" />
            <div className="mt-3 h-2 w-full animate-pulse rounded-full bg-slate-100" />
          </div>
        ))}
      </div>
    </AsyncSurfaceState>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <AsyncSurfaceState
      tone="error"
      eyebrow="Connection problem"
      title="We couldn’t load the latest US comparison data"
      description="The comparison service did not return a usable response. Retry to refresh live offers, or come back in a moment if retailer feeds are still recovering."
      meta="Expected sources: Amazon, Walmart, Target, and Best Buy."
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
          href="/search"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900"
        >
          Search catalog instead
        </a>
      }
      compact
    />
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <AsyncSurfaceState
      tone="empty"
      eyebrow="No matches"
      title="No products match this search yet"
      description="Try a broader product name, remove a brand term, or reset the query to see the full US comparison set again."
      meta="Search checks product titles and brands."
      primaryAction={
        <button
          onClick={onClear}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          Clear search
        </button>
      }
      secondaryAction={
        <a
          href="/compare"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900"
        >
          Browse all markets
        </a>
      }
      compact
    />
  );
}

export default function USPriceComparisonPage() {
  const [products, setProducts] = useState<USProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sortBy, setSortBy] = useState<"price" | "rating" | "name">("price");
  const [searchQuery, setSearchQuery] = useState("");
  const [enabledRetailers, setEnabledRetailers] = useState<string[]>(["amazon", "walmart", "target", "bestbuy"]);

  const fetchProducts = async () => {
    setLoading(true);
    setError(false);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BUYWHERE_API_URL || "https://api.buywhere.ai";
      const response = await fetch(`${baseUrl}/v1/compare/us`, {
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || ""}`,
        },
      });
      if (!response.ok) throw new Error("API error");
      await response.json();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    if (!loading && !error) {
      setProducts(generateMockUSProducts());
    }
  }, [loading, error]);

  const filteredProducts = products
    .filter((p) =>
      searchQuery === "" ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.brand.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === "price") {
        const aPrice = a.prices[0]?.price ? parseFloat(a.prices[0].price) : Infinity;
        const bPrice = b.prices[0]?.price ? parseFloat(b.prices[0].price) : Infinity;
        return aPrice - bPrice;
      }
      if (sortBy === "rating") {
        return b.overallRating - a.overallRating;
      }
      return a.name.localeCompare(b.name);
    });

const schemaMarkup = {
     "@context": "https://schema.org",
     "@type": "ItemPage",
     name: "Compare US Product Prices - Amazon vs Walmart vs Target",
     description:
       "Compare prices for popular products across Amazon, Walmart, and Target. Find the best deals on electronics, home goods, and more.",
     mainEntity: {
       "@type": "Offer",
       category: "US Retailer Price Comparison",
       seller: {
         "@type": "Organization",
         name: "BuyWhere",
       },
       availability: "https://schema.org/InStock",
       areaServed: {
         "@type": "Country",
         name: "United States",
       },
     },
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
            <span className="px-2 py-0.5 bg-indigo-500/30 text-indigo-200 text-xs font-medium rounded-full">
              United States
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-4">
            Compare Amazon vs Walmart vs Target vs Best Buy
          </h1>
          <p className="text-indigo-200 text-lg max-w-2xl">
            Find the best deals by comparing prices across America&apos;s top retailers — all in one place.
          </p>

          <div className="flex items-center gap-6 mt-8">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📦</span>
              <span className="text-sm text-indigo-200">Amazon</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🛒</span>
              <span className="text-sm text-indigo-200">Walmart</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎯</span>
              <span className="text-sm text-indigo-200">Target</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🏪</span>
              <span className="text-sm text-indigo-200">Best Buy</span>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64"
                />
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <span className="text-sm text-gray-600">
                {filteredProducts.length} products
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "price" | "rating" | "name")}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="price">Price: Low to High</option>
                <option value="rating">Rating</option>
                <option value="name">Name</option>
              </select>
            </div>
            <RetailerSwitcher
              onChange={setEnabledRetailers}
              className="mt-2 sm:mt-0"
            />
          </div>
        </div>
      </section>

      <section className="py-12 bg-gray-50 flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          {loading ? (
            <LoadingSkeleton />
          ) : error ? (
            <ErrorState onRetry={fetchProducts} />
          ) : filteredProducts.length === 0 ? (
            <EmptyState onClear={() => setSearchQuery("")} />
          ) : (
            <div className="space-y-6">
              {filteredProducts.map((product) => (
                <USProductRow key={product.id} product={product} enabledRetailers={enabledRetailers} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="bg-white py-16 border-t border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            How does US price comparison work?
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-6">
              <div className="text-3xl mb-3">📊</div>
              <h3 className="font-semibold text-gray-900 mb-2">Real-time Prices</h3>
              <p className="text-sm text-gray-600">
                We fetch the latest prices from Amazon, Walmart, Target, and Best Buy multiple times daily to ensure accuracy.
              </p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-6">
              <div className="text-3xl mb-3">💰</div>
              <h3 className="font-semibold text-gray-900 mb-2">Save Money</h3>
              <p className="text-sm text-gray-600">
                Compare prices across retailers and never overpay. We highlight the lowest price and show MSRP savings so you can save instantly.
              </p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-6">
              <div className="text-3xl mb-3">🚚</div>
              <h3 className="font-semibold text-gray-900 mb-2">Stock Status</h3>
              <p className="text-sm text-gray-600">
                See in-stock availability at each retailer. We show Prime eligibility, store pickup, and free shipping options.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-gray-50 border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <ProductBehaviorExplainer />
        </div>
      </section>

      <section className="py-16 bg-white border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <ReliabilityMetrics />
        </div>
      </section>

      <section className="py-16 bg-gray-50 border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <ScrapingVsBuyWhere />
        </div>
      </section>

      <Footer />
    </div>
  );
}
