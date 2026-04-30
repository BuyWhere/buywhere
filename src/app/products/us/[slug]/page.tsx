import { Metadata } from "next";
import { notFound } from "next/navigation";
import USProductDetail from "@/components/USProductDetail";
import { resolveUSProductRoute } from "@/lib/us-product-route";

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedProduct = await resolveUSProductRoute(params.slug);
  const productName = resolvedProduct?.name || "US Product";
  const productSlug = resolvedProduct?.slug || params.slug;
  const description = resolvedProduct
    ? `Compare prices for ${productName} across Amazon, Walmart, Target, and Best Buy.`
    : "Compare prices across top US retailers on BuyWhere.";
  const pageUrl = `https://buywhere.ai/products/us/${productSlug}`;

  return {
    title: `${productName} - BuyWhere`,
    description,
    alternates: {
      canonical: pageUrl,
    },
    openGraph: {
      title: `${productName} - BuyWhere`,
      description,
      url: pageUrl,
      type: "website",
      images: [
        {
          url: "https://buywhere.ai/assets/img/og-image.png",
          width: 1200,
          height: 630,
          alt: `${productName} - Compare prices on BuyWhere US`,
        },
        {
          url: "https://buywhere.ai/assets/img/og-image.svg",
          width: 1200,
          height: 630,
          alt: `${productName} - Compare prices on BuyWhere US`,
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
