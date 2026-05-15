import { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { toSiteUrl } from "@/lib/site-url";
import { resolveUSProductRoute } from "@/lib/us-product-route";

interface PageProps {
  params: { productId: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedProduct = await resolveUSProductRoute(params.productId);
  if (!resolvedProduct) return { title: "Product Not Found" };

  const canonicalUrl = toSiteUrl(`/products/us/${resolvedProduct.slug}`);

  return {
    title: `${resolvedProduct.name} - BuyWhere`,
    description: `Compare prices for ${resolvedProduct.name} across Amazon, Walmart, Target, and Best Buy.`,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${resolvedProduct.name} - BuyWhere`,
      description: `Compare prices for ${resolvedProduct.name} across Amazon, Walmart, Target, and Best Buy.`,
      url: toSiteUrl(`/compare/us/${params.productId}`),
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

export default async function USProductPage({ params }: PageProps) {
  const resolvedProduct = await resolveUSProductRoute(params.productId);

  if (!resolvedProduct) {
    notFound();
  }

  permanentRedirect(`/products/us/${resolvedProduct.slug}/`);
}
