import { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import USProductDetail from "@/components/USProductDetail";
import { toSiteUrl } from "@/lib/site-url";
import { resolveUSProductRoute, type ResolvedUSProductRoute, slugToSearchRedirect } from "@/lib/us-product-route";
import { normalizeUSMerchantPrice, type USMerchantPrice, type USProduct, type USProductOfferApiItem } from "@/lib/us-products";

interface PageProps {
  params: { slug: string };
}

function titleCaseUSProductSlug(slugPart: string): string {
  return slugPart
    .replace(/-/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveUSProductRouteFromSlug(slug: string): ResolvedUSProductRoute | null {
  const decoded = decodeURIComponent(slug).toLowerCase().replace(/\/+$/g, "");
  const match = decoded.match(/^(.*?)-([0-9]{6,})$/);
  if (!match) return null;

  const [, nameSlug, productId] = match;
  const name = titleCaseUSProductSlug(nameSlug);
  if (!name || !productId) return null;

  return {
    id: productId,
    name,
    slug: decoded,
    lastUpdated: new Date().toISOString(),
  };
}

async function resolveUSProductPageRoute(slug: string): Promise<ResolvedUSProductRoute | null> {
  return (await resolveUSProductRoute(slug)) ?? resolveUSProductRouteFromSlug(slug);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedProduct = await resolveUSProductPageRoute(params.slug);
  if (!resolvedProduct) return { title: "Product Not Found", robots: { index: false, follow: false } };

  const pageUrl = toSiteUrl(`/products/us/${resolvedProduct.slug}`);
  const socialImageUrl = `/api/og-image?title=${encodeURIComponent(resolvedProduct.name)}`;

  return {
    title: `${resolvedProduct.name} - BuyWhere`,
    description: `Compare prices for ${resolvedProduct.name} across Amazon, Walmart, Target, and Best Buy.`,
    alternates: {
      canonical: pageUrl,
    },
    openGraph: {
      title: `${resolvedProduct.name} - BuyWhere`,
      description: `Compare prices for ${resolvedProduct.name} across Amazon, Walmart, Target, and Best Buy.`,
      url: pageUrl,
      // Next 14's Metadata API rejects the Open Graph `product` type.
      // Keep this as `website` but make the PDP product-specific via Product
      // JSON-LD plus the route-specific generated OG image below.
      type: "website",
      images: [
        {
          url: socialImageUrl,
          width: 1200,
          height: 630,
          alt: `${resolvedProduct.name} - Compare prices on BuyWhere US`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${resolvedProduct.name} - BuyWhere`,
      description: `Compare prices for ${resolvedProduct.name} across Amazon, Walmart, Target, and Best Buy.`,
      images: [socialImageUrl],
    },
  };
}

async function fetchUSProductSSR(productId: string): Promise<USProduct | undefined> {
  const baseUrl = process.env.BUYWHERE_API_INTERNAL_URL || process.env.NEXT_PUBLIC_BUYWHERE_API_URL || "https://api.buywhere.ai";
  const apiKey = process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";
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
          name: apiMatch.name || resolvedProductName(productId),
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

function resolvedProductName(productId: string): string {
  return `Product ${productId}`;
}

function formatSSRPrice(price: string | null): string {
  if (price === null) return "Price unavailable";
  const numericPrice = Number(price);
  if (Number.isFinite(numericPrice)) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numericPrice);
  }
  return price;
}

function buildSSRProductJsonLd(product: USProduct, pageUrl: string) {
  const offers = product.prices
    .filter((price) => price.price !== null)
    .map((price) => ({
      "@type": "Offer",
      price: price.price,
      priceCurrency: "USD",
      availability: price.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: price.url,
      seller: { "@type": "Organization", name: price.merchant },
    }));

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    url: pageUrl,
    ...(product.image && { image: product.image }),
    ...(product.brand && { brand: { "@type": "Brand", name: product.brand } }),
    ...(offers.length > 0 && { offers }),
  };
}

function buildSSRBreadcrumbJsonLd(product: USProduct, pageUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: toSiteUrl("/") },
      { "@type": "ListItem", position: 2, name: "US Products", item: toSiteUrl("/compare/us") },
      { "@type": "ListItem", position: 3, name: product.name, item: pageUrl },
    ],
  };
}

function makeFallbackProduct(resolvedProduct: ResolvedUSProductRoute): USProduct {
  const fallbackOffer: USMerchantPrice = {
    merchant: "BuyWhere US catalog",
    price: null,
    url: "/compare/us",
    inStock: true,
    lastUpdated: resolvedProduct.lastUpdated,
  };

  return {
    id: resolvedProduct.id,
    name: resolvedProduct.name,
    image: "",
    description: `Compare current US merchant offers for ${resolvedProduct.name} on BuyWhere.`,
    specs: {},
    prices: [fallbackOffer],
    overallRating: 0,
    reviewCount: 0,
    brand: "",
    sku: `SKU-${resolvedProduct.id}`,
    lastUpdated: resolvedProduct.lastUpdated,
  };
}

function ProductSSRPreview({ product, pageUrl }: { product: USProduct; pageUrl: string }) {
  const productSchema = buildSSRProductJsonLd(product, pageUrl);
  const breadcrumbSchema = buildSSRBreadcrumbJsonLd(product, pageUrl);
  const availablePrices = product.prices.filter((price) => price.price !== null);
  const lowestPrice = availablePrices.length > 0
    ? availablePrices.reduce((min, price) => {
        const minValue = Number(min.price);
        const priceValue = Number(price.price);
        return Number.isFinite(priceValue) && (!Number.isFinite(minValue) || priceValue < minValue) ? price : min;
      })
    : null;
  const primaryOffer = lowestPrice ?? product.prices[0] ?? null;

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
      <section className="bg-white border-b border-gray-100 px-4 py-6 sm:px-6" aria-label="Product summary">
        <nav aria-label="breadcrumb" className="mx-auto mb-3 max-w-6xl text-sm text-gray-500">
          <ol className="flex flex-wrap items-center gap-2">
            <li><Link href="/" className="hover:text-indigo-600">Home</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link href="/compare/us" className="hover:text-indigo-600">US Products</Link></li>
            <li aria-hidden="true">/</li>
            <li className="font-medium text-gray-900">{product.name}</li>
          </ol>
        </nav>
        <div className="mx-auto max-w-6xl">
          <h1 className="text-3xl font-bold text-gray-900">{product.name}</h1>
          <p className="mt-2 max-w-3xl text-gray-600">{product.description}</p>
          {primaryOffer ? (
            <p className="mt-3 text-sm font-medium text-gray-700">
              {primaryOffer.merchant}: {formatSSRPrice(primaryOffer.price)} {primaryOffer.inStock ? "in stock" : "out of stock"}.
            </p>
          ) : null}
          {availablePrices.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-3 text-sm text-gray-700">
              {availablePrices.map((price) => (
                <li key={`${price.merchant}-${price.url}`}>
                  <a href={price.url} className="font-medium text-indigo-600 hover:underline">{price.merchant}</a>: {formatSSRPrice(price.price)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>
    </>
  );
}

export default async function USProductSlugPage({ params }: PageProps) {
  const resolvedProduct = await resolveUSProductPageRoute(params.slug);

  if (!resolvedProduct) {
    // Slug is unknown OR the US product catalog is unreachable (e.g. the API
    // now requires `BUYWHERE_API_KEY` and this deploy hasn't been provisioned
    // with one yet). Don't drop the user on a misleading "Product Not Found"
    // 404 — bounce them to a real search results page derived from the slug,
    // where the merchant offer CTAs still work.
    permanentRedirect(slugToSearchRedirect(params.slug));
  }

  const initialData = await fetchUSProductSSR(resolvedProduct.id);
  const ssrProduct = initialData ?? makeFallbackProduct(resolvedProduct);
  const pageUrl = toSiteUrl(`/products/us/${resolvedProduct.slug}`);

  return (
    <>
      <ProductSSRPreview product={ssrProduct} pageUrl={pageUrl} />
      <USProductDetail productId={resolvedProduct.id} />
    </>
  );
}
