import { headers } from "next/headers";
import Link from "next/link";
import Image from "next/image";
import { buildAffiliateRedirectHref, buildAffiliateRedirectFromProductId } from "@/lib/affiliate-redirect";

// BUY-75418: server-rendered product grid for /us and /us/<category>.
// Fetches >=12 products per category via the internal search API and renders
// them as a plain HTML grid so AI crawlers (OAI-SearchBot, GPTBot, ClaudeBot)
// that do not execute JS still see real product names, prices, and retailer links.
// Merchant links use /r/... (rel="nofollow sponsored") per the affiliate policy.

const SSR_PRODUCT_LIMIT = 12;

interface SearchApiItem {
  id: string;
  title: string;
  price: { amount: number; currency: string } | number | null;
  merchant: string;
  merchant_name?: string;
  image_url?: string | null;
  affiliate_redirect_url?: string | null;
  url?: string;
  metadata?: {
    in_stock?: boolean;
    availability?: string;
    category?: string;
  };
  updated_at?: string;
}

interface SearchApiResponse {
  data?: SearchApiItem[];
  items?: SearchApiItem[];
  results?: SearchApiItem[];
  total?: number;
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(currency === "SGD" ? "en-SG" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

async function fetchCategoryProducts(
  category: string,
): Promise<SearchApiItem[]> {
  const params = new URLSearchParams({
    category,
    country: "US",
    limit: String(SSR_PRODUCT_LIMIT),
  });

  let origin = "https://buywhere.ai";
  try {
    const headerList = headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
    const proto = headerList.get("x-forwarded-proto") ?? "https";
    if (host) origin = `${proto}://${host}`;
  } catch {
    // keep public default
  }

  try {
    const response = await fetch(
      `${origin}/api/products/search?${params.toString()}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    if (!response.ok) return [];
    const data: SearchApiResponse = await response.json();
    const items =
      data.data ?? data.items ?? data.results ?? [];
    if (!Array.isArray(items)) return [];
    return items.slice(0, SSR_PRODUCT_LIMIT) as SearchApiItem[];
  } catch {
    return [];
  }
}

interface USCategoryProductGridProps {
  /** URL slug, e.g. "electronics", "laptops-computers" */
  category: string;
  /** Display name, e.g. "Electronics" */
  categoryName: string;
}

export async function USCategoryProductGrid({
  category,
  categoryName,
}: USCategoryProductGridProps) {
  const products = await fetchCategoryProducts(category);

  if (products.length === 0) {
    return null;
  }

  return (
    <section className="py-16 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900">
            Top products in {categoryName}
          </h2>
          <Link
            href={`/search?q=${encodeURIComponent(categoryName)}&country=US`}
            className="text-indigo-600 font-medium hover:text-indigo-700 transition-colors text-sm"
          >
            View all →
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.map((product) => {
            const price =
              typeof product.price === "object" && product.price !== null
                ? product.price
                : null;
            const amount =
              price && typeof price === "object" ? price.amount : null;
            const currency =
              (price && typeof price === "object" && price.currency) || "USD";
            const displayPrice =
              amount !== null
                ? formatPrice(amount, currency)
                : "Price unavailable";
            const merchantName = product.merchant_name ?? product.merchant;
            const inStock =
              product.metadata?.in_stock !== false;
            const imageUrl = product.image_url;
            const productId = product.id;

            // Prefer the row-level /r/… URL when the API gives us one;
            // fall back to a /r/direct/{id} built from the product id.
            const merchantHref =
              buildAffiliateRedirectHref(product.affiliate_redirect_url) ??
              buildAffiliateRedirectFromProductId(productId, "us_category_grid");

            return (
              <div
                key={productId}
                className="group bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-lg hover:border-indigo-100 transition-all duration-200"
              >
                {/* Image */}
                <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
                  {imageUrl ? (
                    <Image
                      src={imageUrl}
                      alt={product.title}
                      fill
                      sizes="(max-width: 768px) 50vw, 288px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center w-full h-full text-4xl text-gray-400">
                      ◎
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1 truncate">
                    {merchantName}
                  </p>
                  <h3 className="text-sm font-medium text-gray-900 line-clamp-2 mb-2 min-h-[2.5rem]">
                    {product.title}
                  </h3>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-lg font-bold text-indigo-600">
                      {displayPrice}
                    </span>
                    <a
                      href={merchantHref}
                      target="_blank"
                      rel="nofollow sponsored noopener noreferrer"
                      data-affiliate-redirect="us-category-grid"
                      className="inline-flex items-center justify-center rounded-full bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 transition-colors"
                    >
                      Buy →
                    </a>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {inStock ? "In stock" : "Check availability"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs text-gray-500">
            Prices and availability may vary by retailer.
          </p>
        </div>
      </div>
    </section>
  );
}

export default USCategoryProductGrid;
