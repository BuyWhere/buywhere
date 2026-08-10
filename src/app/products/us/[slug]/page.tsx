import { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import USProductDetail from "@/components/USProductDetail";
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
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: `${resolvedProduct.name} - Compare prices on BuyWhere US`,
        },
      ],
    },
  };
}

async function fetchUSProductSSR(productId: string): Promise<USProduct | undefined> {
  const baseUrl = process.env.BUYWHERE_API_INTERNAL_URL || process.env.NEXT_PUBLIC_BUYWHERE_API_URL || "https://api.buywhere.ai";
  const apiKey = process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";
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

  const initialData = await fetchUSProductSSR(resolvedProduct.id);

  return <USProductDetail productId={resolvedProduct.id} initialData={initialData} />;
}
