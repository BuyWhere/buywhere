import { Metadata } from "next";
import { notFound } from "next/navigation";
import { toSiteUrl } from "@/lib/site-url";
import { resolveSGProductRoute } from "@/lib/sg-product-route";
import { buildAffiliateRedirectUrl, buildAffiliateRedirectFromMerchantUrl } from "@/lib/click-attribution";

interface PageProps {
  params: { slug: string };
}

interface SGProductPriceData {
  merchant: string;
  price: string | null;
  currency: string;
  inStock: boolean;
  url: string;
}

async function fetchSGProductPrices(productId: string): Promise<SGProductPriceData[]> {
  const baseUrl = process.env.BUYWHERE_API_INTERNAL_URL || process.env.NEXT_PUBLIC_BUYWHERE_API_URL || "https://api.buywhere.ai";
  const apiKey = process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";
  const numericId = parseInt(productId.replace(/[^0-9]/g, ""), 10) || 1;

  try {
    const res = await fetch(`${baseUrl}/v1/products/${numericId}/prices`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const data = await res.json() as { prices?: Array<{ merchant: string; price: number; currency: string; in_stock: boolean; url: string }> };
      if (data.prices && data.prices.length > 0) {
        return data.prices
          .filter((p) => p.merchant && p.url && p.url !== "#")
          .map((p) => ({
            merchant: p.merchant,
            price: p.price ? `SGD ${p.price.toFixed(2)}` : null,
            currency: p.currency || "SGD",
            inStock: p.in_stock,
            url: p.url,
          }));
      }
    }
  } catch {
    // API unavailable
  }

  return [];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedProduct = await resolveSGProductRoute(params.slug);
  if (!resolvedProduct) return { title: "Product Not Found" };

  const pageUrl = toSiteUrl(`/products/sg/${resolvedProduct.slug}`);

  return {
    title: `${resolvedProduct.name} - Compare Prices Singapore | BuyWhere`,
    description: `Compare prices for ${resolvedProduct.name} across Lazada, Shopee, Amazon SG, FairPrice, and top Singapore retailers. Find the best deal in SGD.`,
    alternates: {
      canonical: pageUrl,
    },
    openGraph: {
      title: `${resolvedProduct.name} - Compare Prices Singapore | BuyWhere`,
      description: `Compare prices for ${resolvedProduct.name} across Lazada, Shopee, Amazon SG, FairPrice, and top Singapore retailers.`,
      url: pageUrl,
      type: "website",
      siteName: "BuyWhere",
      locale: "en_SG",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: `${resolvedProduct.name} - Compare prices on BuyWhere SG`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${resolvedProduct.name} - Compare Prices Singapore | BuyWhere`,
      description: `Compare prices for ${resolvedProduct.name} across Lazada, Shopee, Amazon SG, FairPrice, and top Singapore retailers.`,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function SGProductSlugPage({ params }: PageProps) {
  const resolvedProduct = await resolveSGProductRoute(params.slug);

  if (!resolvedProduct) {
    notFound();
  }

  const prices = await fetchSGProductPrices(resolvedProduct.id);
  const availablePrices = prices.filter((p) => p.price !== null);
  const pageUrl = toSiteUrl(`/products/sg/${resolvedProduct.slug}`);

  // BUY-74926: replace the lone AggregateOffer with an `offers` array containing
  // one Offer per priced retailer (mirrors the visible <table>) plus an
  // AggregateOffer summary. AI crawlers can index the individual Offers; the
  // AggregateOffer is the fallback for engines that only honour one shape.
  const numericAvailablePrices = availablePrices
    .map((p) => parseFloat((p.price || "0").replace(/[^0-9.]/g, "")))
    .filter((n) => Number.isFinite(n));
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: resolvedProduct.name,
    description: `Compare prices for ${resolvedProduct.name} across top Singapore retailers including Lazada, Shopee, Amazon SG, FairPrice, and Courts.`,
    url: pageUrl,
    offers:
      availablePrices.length > 0
        ? [
            ...availablePrices
              .map((p) => {
                const numeric = parseFloat((p.price || "0").replace(/[^0-9.]/g, ""));
                if (!Number.isFinite(numeric)) return null;
                return {
                  "@type": "Offer",
                  price: numeric.toFixed(2),
                  priceCurrency: p.currency || "SGD",
                  availability: p.inStock
                    ? "https://schema.org/InStock"
                    : "https://schema.org/OutOfStock",
                  url: p.url,
                  seller: { "@type": "Organization", name: p.merchant },
                };
              })
              .filter((o): o is NonNullable<typeof o> => o !== null),
            {
              "@type": "AggregateOffer",
              priceCurrency: "SGD",
              offerCount: numericAvailablePrices.length,
              lowPrice: numericAvailablePrices.length > 0
                ? Math.min(...numericAvailablePrices).toFixed(2)
                : undefined,
              highPrice: numericAvailablePrices.length > 0
                ? Math.max(...numericAvailablePrices).toFixed(2)
                : undefined,
              availability: "https://schema.org/InStock",
            },
          ]
        : {
            "@type": "AggregateOffer",
            priceCurrency: "SGD",
            availability: "https://schema.org/InStock",
          },
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://buywhere.ai/" },
      { "@type": "ListItem", position: 2, name: "Singapore Products", item: "https://buywhere.ai/products/sg/" },
      { "@type": "ListItem", position: 3, name: resolvedProduct.name, item: pageUrl },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <div className="flex flex-col min-h-screen">
        <main id="main-content" className="flex-1">
          <section className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900 text-white py-10">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <nav className="text-sm text-indigo-200 mb-4" aria-label="Breadcrumb">
                <a href="/" className="hover:text-white">Home</a>
                <span className="mx-2">/</span>
                <a href="/products/sg/" className="hover:text-white">Singapore Products</a>
                <span className="mx-2">/</span>
                <span className="text-white">{resolvedProduct.name}</span>
              </nav>
              <h1 className="text-3xl font-bold mb-3">{resolvedProduct.name}</h1>
              <p className="text-lg text-indigo-100">
                Compare live Singapore catalog offers and find the best deal in SGD.
              </p>
            </div>
          </section>

          <section className="py-10 bg-gray-50">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Price Comparison — {resolvedProduct.name}
              </h2>

              {/* BUY-74926: visible "Prices checked <date>" + machine-readable SSR table
                  so AI crawlers (OAI-SearchBot, GPTBot, ClaudeBot) can quote retailer
                  names + SGD prices + checked date exactly as the JSON-LD graph says. */}
              {availablePrices.length > 0 ? (
                <>
                  <p className="mb-4 text-sm text-gray-600" data-ssr-prices-checked={new Date().toISOString()}>
                    Prices checked{" "}
                    <time dateTime={new Date().toISOString()}>
                      {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </time>
                    . BuyWhere compares {availablePrices.length} retailer
                    {availablePrices.length === 1 ? "" : "s"} for this product in Singapore.
                  </p>
                  <table className="mb-8 min-w-full divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white text-left text-sm shadow-sm">
                    <caption className="sr-only">Live Singapore retailer prices for {resolvedProduct.name}, checked {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.</caption>
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-semibold text-gray-700">Retailer</th>
                        <th scope="col" className="px-4 py-3 font-semibold text-gray-700">Price</th>
                        <th scope="col" className="px-4 py-3 font-semibold text-gray-700">Currency</th>
                        <th scope="col" className="px-4 py-3 font-semibold text-gray-700">Availability</th>
                        <th scope="col" className="px-4 py-3 font-semibold text-gray-700">Buy</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {availablePrices.map((p) => {
                        const numericPrice = (p.price || "").replace(/[^0-9.]/g, "");
                        const buyHref =
                          buildAffiliateRedirectUrl(
                            resolvedProduct.id,
                            `/products/sg/${resolvedProduct.slug}`,
                          ) || buildAffiliateRedirectFromMerchantUrl(p.url) || "#";
                        return (
                          <tr key={p.merchant}>
                            <th scope="row" className="px-4 py-3 font-medium text-gray-900">{p.merchant}</th>
                            <td className="px-4 py-3 text-gray-900" data-merchant={p.merchant}>
                              <span data-price={numericPrice || undefined}>{p.price}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-700">{p.currency}</td>
                            <td className="px-4 py-3 text-gray-700">{p.inStock ? "In Stock" : "Out of Stock"}</td>
                            <td className="px-4 py-3">
                              <a
                                href={buyHref}
                                target="_blank"
                                rel="nofollow sponsored noopener noreferrer"
                                data-affiliate-redirect="sg-product-table"
                                className="text-indigo-600 font-semibold hover:text-indigo-800"
                              >
                                View at {p.merchant}
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                    {availablePrices.map((p) => {
                      const buyHref =
                        buildAffiliateRedirectUrl(
                          resolvedProduct.id,
                          `/products/sg/${resolvedProduct.slug}`,
                        ) || buildAffiliateRedirectFromMerchantUrl(p.url) || "#";
                      return (
                      <div key={p.merchant} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                        <div className="font-semibold text-gray-800 mb-1">{p.merchant}</div>
                        <div className="text-2xl font-bold text-indigo-600 mb-2">{p.price}</div>
                        <div className="text-sm text-gray-500 mb-3">
                          {p.inStock ? "In stock" : "Check availability"}
                        </div>
                        <a
                          href={buyHref}
                          target="_blank"
                          rel="nofollow sponsored noopener noreferrer"
                          data-affiliate-redirect="sg-product-card"
                          className="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
                        >
                          View at {p.merchant}
                          <span aria-hidden="true" className="ml-1">→</span>
                        </a>
                      </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-8">
                  <p className="text-gray-600 mb-4">
                    BuyWhere does not have live retailer offers for <strong>{resolvedProduct.name}</strong> yet.
                  </p>
                  <a href="/products/sg/" className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                    Browse Singapore catalog
                  </a>
                </div>
              )}

              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">
                  About {resolvedProduct.name}
                </h2>
                <p className="text-gray-600 mb-4">
                  BuyWhere helps you find the best price for <strong>{resolvedProduct.name}</strong> in Singapore.
                  We compare prices in real time across Lazada, Shopee, Amazon Singapore, FairPrice Online,
                  Courts, and Harvey Norman so you never overpay.
                </p>
                <p className="text-gray-600">
                  Prices are updated regularly and include promotions, vouchers, and seller discounts.
                  Click on a retailer to buy at today&apos;s lowest price.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
