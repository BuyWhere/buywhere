import { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import USProductDetail from "@/components/USProductDetail";
import USProductSsrPriceTable from "@/components/seo/USProductSsrPriceTable";
import { toSiteUrl } from "@/lib/site-url";
import { resolveUSProductRoute, slugToSearchRedirect } from "@/lib/us-product-route";
import { normalizeUSMerchantPrice, type USProduct, type USProductOfferApiItem } from "@/lib/us-products";

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedProduct = await resolveUSProductRoute(params.slug);
  if (!resolvedProduct) return { title: "Product Not Found", robots: { index: false, follow: false } };

  const pageUrl = toSiteUrl(`/products/us/${resolvedProduct.slug}`);
  const socialImage = `/api/og-image?title=${encodeURIComponent(resolvedProduct.name)}`;

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
      type: "website",
      images: [
        {
          url: socialImage,
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
      images: [socialImage],
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

// BUY-74926: also return the raw /matches API items so the SSR price-table island can
// build its own JSON-LD that mirrors the visible table exactly. The client component
// gets the normalised `USProduct` and the route uses the raw items for the server table.
async function fetchUSProductMatchesRaw(productId: string): Promise<USProductOfferApiItem[]> {
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
      const matchesJson = await matchesRes.json() as { matches?: USProductOfferApiItem[] };
      return Array.isArray(matchesJson.matches) ? matchesJson.matches : [];
    }
  } catch {
    // API unavailable — fall through to []
  }

  return [];
}

function resolvedProductName(productId: string): string {
  return `Product ${productId}`;
}

function buildResolvedProductFallback(resolvedProduct: Awaited<ReturnType<typeof resolveUSProductRoute>>): USProduct | undefined {
  if (!resolvedProduct) return undefined;

  return {
    id: resolvedProduct.id,
    name: resolvedProduct.name,
    image: "/og-image.png",
    description: `Compare current catalog offers and merchant options for ${resolvedProduct.name} on BuyWhere US.`,
    specs: {
      Region: "United States",
      "Catalog source": "BuyWhere US product sitemap",
    },
    prices: [
      {
        merchant: "BuyWhere Catalog",
        price: null,
        url: slugToSearchRedirect(resolvedProduct.slug),
        inStock: true,
        lastUpdated: resolvedProduct.lastUpdated,
        price_missing_reason: "retailer_unavailable",
      },
    ],
    overallRating: 0,
    reviewCount: 0,
    brand: "",
    sku: `SKU-${resolvedProduct.id}`,
    lastUpdated: resolvedProduct.lastUpdated,
  };
}

export default async function USProductSlugPage({ params }: PageProps) {
  const resolvedProduct = await resolveUSProductRoute(params.slug);

  if (!resolvedProduct) {
    // Slug is unknown OR the US product catalog is unreachable (e.g. the API
    // now requires `BUYWHERE_API_KEY` and this deploy hasn't been provisioned
    // with one yet). Don't drop the user on a misleading "Product Not Found"
    // 404 — bounce them to a real search results page derived from the slug,
    // where the merchant offer CTAs still work.
    permanentRedirect(slugToSearchRedirect(params.slug));
  }

  // BUY-74926: server-side, parallel — the matches call that powers both the SSR
  // price table (visible to crawlers without JS) and the client island's
  // initialData. Fetching twice would double upstream load, so issue both reads
  // in parallel and reuse the raw payload for the SSR table.
  const [fetchedProduct, rawMatches] = await Promise.all([
    fetchUSProductSSR(resolvedProduct.id),
    fetchUSProductMatchesRaw(resolvedProduct.id),
  ]);
  const initialData = fetchedProduct ?? buildResolvedProductFallback(resolvedProduct);

  const pagePath = `/products/us/${resolvedProduct.slug}`;

  return (
    <>
      <USProductSsrPriceTable
        productId={resolvedProduct.id}
        productName={resolvedProduct.name}
        pagePath={pagePath}
        description={`Compare current retailer pricing for ${resolvedProduct.name} across Amazon, Walmart, Target, and Best Buy.`}
        matches={rawMatches}
        sku={`SKU-${resolvedProduct.id}`}
        category="Products"
      />
      <USProductDetail productId={resolvedProduct.id} initialData={initialData} />
    </>
  );
}