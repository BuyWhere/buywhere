import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import Link from "next/link";
import { resolveUSProductRoute, slugToSearchRedirect } from "@/lib/us-product-route";
import { normalizeUSMerchantPrice, type USProduct, type USProductOfferApiItem } from "@/lib/us-products";

const INTERNAL_ORIGIN =
  process.env.BUYWHERE_INTERNAL_ORIGIN ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://buywhere.ai";

// BUY-69630 pattern: call the API service directly via the Railway internal URL with
// the SSR-held API key.
const API_INTERNAL_URL = (
  process.env.BUYWHERE_API_INTERNAL_URL ||
  "https://api.buywhere.ai"
).replace(/\/$/, "");
const API_KEY = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";

interface PageProps {
  params: { slug: string };
}

// BUY-70240: The /product/[slug] URL pattern (e.g. /product/apple-airpods-pro-2nd-generation)
// was returning 404, which caused the 404 page to fall back to the root layout metadata
// (homepage og:title, og:description, og:image). This route handles those URLs by resolving
// the slug to a US product and rendering product-specific social metadata.

async function fetchUSProductSSR(productId: string): Promise<USProduct | undefined> {
  const baseUrl = API_INTERNAL_URL;
  const apiKey = API_KEY;
  const numericId = parseInt(productId.replace(/[^0-9]/g, ""), 10) || 1;

  try {
    const matchesRes = await fetch(`${baseUrl}/v1/products/${numericId}/matches`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });

    if (matchesRes.ok) {
      const matchesJson = await matchesRes.json() as { matches?: Array<USProductOfferApiItem & { name?: string; match_score?: number }> };
      if (matchesJson.matches && matchesJson.matches.length > 0) {
        const apiMatch = matchesJson.matches[0];
        const prices = matchesJson.matches.map(normalizeUSMerchantPrice).filter((price): price is NonNullable<typeof price> => Boolean(price));
        if (prices.length === 0) return undefined;

        return {
          id: productId,
          name: apiMatch.name || `Product ${productId}`,
          image: "",
          description: `Compare current catalog offers for ${apiMatch.name || "this product"}.`,
          specs: apiMatch.match_score ? { "Match Score": `${(apiMatch.match_score * 100).toFixed(0)}%` } : {},
          prices,
          overallRating: 0,
          reviewCount: 0,
          brand: "",
          sku: `SKU-${productId}`,
        };
      }
    }
  } catch {
    // API unavailable — return undefined (honest empty state)
  }

  return undefined;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedProduct = await resolveUSProductRoute(params.slug);
  if (!resolvedProduct) {
    return { title: "Product Not Found", robots: { index: false, follow: false } };
  }

  const canonicalUrl = `${INTERNAL_ORIGIN}/product/${params.slug}`;
  const socialImage = `/api/og-image?title=${encodeURIComponent(resolvedProduct.name)}`;

  return {
    title: `${resolvedProduct.name} — BuyWhere`,
    description: `Compare prices for ${resolvedProduct.name} across US retailers. Find the best deals on BuyWhere.`,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${resolvedProduct.name} — BuyWhere`,
      description: `Compare prices for ${resolvedProduct.name} across US retailers.`,
      url: canonicalUrl,
      // Next's Metadata type omits the Open Graph "product" object type even
      // though social crawlers accept it. Cast keeps TS happy while emitting
      // <meta property="og:type" content="product" /> for PDP previews.
      type: "product" as "website",
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: `${resolvedProduct.name} — Compare prices on BuyWhere`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${resolvedProduct.name} — BuyWhere`,
      description: `Compare prices for ${resolvedProduct.name} across US retailers.`,
      images: [socialImage],
    },
  };
}

export default async function ProductDetailPage({ params }: PageProps) {
  const resolvedProduct = await resolveUSProductRoute(params.slug);

  if (!resolvedProduct) {
    // Slug doesn't match any known US product. Redirect to search so the user
    // lands on a useful page instead of a 404 with homepage metadata.
    permanentRedirect(slugToSearchRedirect(params.slug));
  }

  const initialData = await fetchUSProductSSR(resolvedProduct.id);

  // Use SSR data if available, otherwise fall back to a minimal product object
  const product = initialData ?? {
    id: resolvedProduct.id,
    name: resolvedProduct.name,
    image: "/og-image.png",
    description: `Compare current catalog offers and merchant options for ${resolvedProduct.name} on BuyWhere.`,
    specs: { Region: "United States", "Catalog source": "BuyWhere US product catalog" },
    prices: [],
    overallRating: 0,
    reviewCount: 0,
    brand: "",
    sku: `SKU-${resolvedProduct.id}`,
    lastUpdated: resolvedProduct.lastUpdated,
  };

  const canonicalUrl = `${INTERNAL_ORIGIN}/product/${params.slug}`;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: product.name,
            description: product.description,
            ...(product.brand && { brand: { "@type": "Brand", name: product.brand } }),
            ...(product.image && { image: product.image }),
            ...(product.sku && { sku: product.sku }),
            offers: product.prices
              .filter((p) => p.price !== null)
              .map((p) => ({
                "@type": "Offer",
                price: p.price,
                priceCurrency: "USD",
                availability: p.inStock
                  ? "https://schema.org/InStock"
                  : "https://schema.org/OutOfStock",
                seller: { "@type": "Organization", name: p.merchant },
              })),
          }),
        }}
      />
      <main id="main-content" className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <nav aria-label="breadcrumb" className="mb-6 text-sm text-gray-500">
          <ol className="flex items-center gap-2 flex-wrap">
            <li>
              <Link href="/" className="hover:text-indigo-600">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/us" className="hover:text-indigo-600">
                US
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-gray-900 font-medium line-clamp-1">
              {product.name}
            </li>
          </ol>
        </nav>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {product.image && product.image !== "/og-image.png" && (
            <div className="aspect-square max-h-64 overflow-hidden bg-gray-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={product.image}
                alt={product.name}
                className="w-full h-full object-contain p-4"
              />
            </div>
          )}

          <div className="p-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {product.name}
            </h1>

            {product.brand && (
              <p className="text-sm text-gray-500 mb-4">
                by{" "}
                <span className="text-gray-700 font-medium">{product.brand}</span>
              </p>
            )}

            <div className="mb-6">
              <p className="text-sm text-gray-600">
                Compare prices for {product.name} from multiple US retailers.
              </p>
            </div>

            {product.prices.length > 0 ? (
              <div className="space-y-3">
                {product.prices.map((offer, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">{offer.merchant}</p>
                      {offer.price !== null ? (
                        <p className="text-lg font-bold text-indigo-600">${offer.price}</p>
                      ) : (
                        <p className="text-sm text-gray-500">Price unavailable</p>
                      )}
                    </div>
                    {offer.url && offer.url !== "#" && (
                      <a
                        href={offer.url}
                        target="_blank"
                        rel="noopener noreferrer sponsored"
                        className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
                      >
                        View at {offer.merchant}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
                <p className="text-gray-500">
                  No price offers available right now. Check back soon.
                </p>
              </div>
            )}

            {product.description && (
              <div className="prose prose-sm text-gray-700 mt-6">
                <p>{product.description}</p>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                Prices and availability updated{" "}
                {product.lastUpdated
                  ? new Date(product.lastUpdated).toLocaleDateString()
                  : "recently"}
                .{" "}
                <Link href={`/products/us/${resolvedProduct.slug}`} className="text-indigo-600 hover:underline">
                  View full comparison →
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
