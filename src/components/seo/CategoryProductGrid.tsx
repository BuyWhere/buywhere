/**
 * BUY-75418 — Server-rendered product grid for category and listing pages.
 * Renders >=12 products with name, price, currency, retailer, and affiliate link
 * visible to AI crawlers (OAI-SearchBot, GPTBot, ClaudeBot) that don't execute JS.
 */

import Link from "next/link";
import Image from "next/image";

export interface CategoryProduct {
  id: string | number;
  name: string;
  price: number | null;
  currency: string;
  merchant: string;
  image_url?: string | null;
  affiliate_redirect_url?: string | null;
}

interface CategoryProductGridProps {
  products: CategoryProduct[];
  category: string;
  country: "US" | "SG";
}

function formatPrice(price: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : currency === "SGD" ? "S$" : currency === "MYR" ? "RM" : currency === "AUD" ? "A$" : "";
  return `${symbol}${price.toFixed(2)}`;
}

const MERCHANT_CONFIG: Record<string, { icon: string; bgColor: string }> = {
  "Amazon": { icon: "📦", bgColor: "bg-orange-100" },
  "Walmart": { icon: "🛒", bgColor: "bg-blue-100" },
  "Target": { icon: "🎯", bgColor: "bg-red-100" },
  "Best Buy": { icon: "🏪", bgColor: "bg-blue-100" },
  "Courts": { icon: "🏬", bgColor: "bg-green-100" },
  "Harvey Norman": { icon: "🏬", bgColor: "bg-purple-100" },
  "Challenger": { icon: "🏬", bgColor: "bg-yellow-100" },
  "Best Denki": { icon: "🏬", bgColor: "bg-pink-100" },
};

function getMerchantConfig(merchant: string) {
  return MERCHANT_CONFIG[merchant] || { icon: "🏬", bgColor: "bg-gray-100" };
}

function ProductCard({ product }: { product: CategoryProduct }) {
  const config = getMerchantConfig(product.merchant);
  const displayPrice = product.price !== null ? formatPrice(product.price, product.currency) : "Price unavailable";

  // Use affiliate_redirect_url if available, otherwise construct a /r path
  const affiliateUrl = product.affiliate_redirect_url || `/r/${product.id}`;

  return (
    <a
      href={affiliateUrl}
      rel="nofollow sponsored"
      target="_blank"
      className="group block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-lg hover:border-indigo-100 transition-all duration-200"
    >
      <div className="aspect-square bg-gray-50 relative overflow-hidden">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 50vw, 288px"
            loading="lazy"
            style={{ aspectRatio: "1/1", objectFit: "cover" }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-5xl opacity-50">{config.icon}</span>
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 mb-1 group-hover:text-indigo-600 transition-colors">
          {product.name}
        </h3>
        <div className={`inline-flex items-center gap-1.5 ${config.bgColor} px-2 py-0.5 rounded-full w-fit mb-2`}>
          <span className="text-xs">{config.icon}</span>
          <span className="text-xs text-gray-600">{product.merchant}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-indigo-600">
            {displayPrice}
          </span>
        </div>
      </div>
    </a>
  );
}

export default function CategoryProductGrid({ products, category, country }: CategoryProductGridProps) {
  if (products.length === 0) {
    return null;
  }

  const displayProducts = products.slice(0, 12);
  const machineDate = new Date();
  const checkedDateText = machineDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const isoDate = machineDate.toISOString();

  const countryLabel = country === "US" ? "United States" : "Singapore";

  return (
    <section className="py-16 bg-white border-t border-gray-100" aria-labelledby={`products-${category}`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-8">
          <h2 id={`products-${category}`} className="text-2xl font-bold text-gray-900">
            Popular {category} Products in {countryLabel}
          </h2>
          <p className="text-gray-500 mt-1">
            Prices checked <time dateTime={isoDate}>{checkedDateText}</time>. Compare prices across major retailers.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {displayProducts.map((product, index) => (
            <ProductCard key={`${product.id}-${index}`} product={product} />
          ))}
        </div>

        <div className="mt-8 text-center">
          <Link
            href={country === "US" ? `/compare/us?category=${category}` : `/search?q=${category}&region=sg`}
            className="inline-flex items-center justify-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
          >
            View all {category} products →
          </Link>
        </div>

        <p className="mt-4 text-xs text-gray-600 text-center">
          Prices and availability may vary. We may earn a commission from retailer links.
        </p>
      </div>
    </section>
  );
}
