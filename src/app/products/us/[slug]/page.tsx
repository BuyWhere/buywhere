import { Metadata } from "next";
import { notFound } from "next/navigation";
import USProductDetail from "@/components/USProductDetail";
import { toSiteUrl } from "@/lib/site-url";
import { resolveUSProductRoute } from "@/lib/us-product-route";

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedProduct = await resolveUSProductRoute(params.slug);
  if (!resolvedProduct) return { title: "Product Not Found" };

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

export default async function USProductSlugPage({ params }: PageProps) {
  const resolvedProduct = await resolveUSProductRoute(params.slug);

  if (!resolvedProduct) {
    notFound();
  }

  return <USProductDetail productId={resolvedProduct.id} />;
}
