import { Metadata } from "next";
import { notFound } from "next/navigation";
import { toSiteUrl } from "@/lib/site-url";
import { resolveSGProductRoute } from "@/lib/sg-product-route";

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedProduct = await resolveSGProductRoute(params.slug);
  if (!resolvedProduct) return { title: "Product Not Found" };

  const pageUrl = toSiteUrl(`/products/sg/${resolvedProduct.slug}`);

  return {
    title: `${resolvedProduct.name} - Compare Prices Singapore | BuyWhere`,
    description: `Compare prices for ${resolvedProduct.name} across Lazada, Shopee, Amazon SG, and top Singapore retailers.`,
    alternates: {
      canonical: pageUrl,
    },
    openGraph: {
      title: `${resolvedProduct.name} - Compare Prices Singapore | BuyWhere`,
      description: `Compare prices for ${resolvedProduct.name} across Lazada, Shopee, Amazon SG, and top Singapore retailers.`,
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
      description: `Compare prices for ${resolvedProduct.name} across Lazada, Shopee, Amazon SG, and top Singapore retailers.`,
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

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: resolvedProduct.name,
    description: `Compare prices for ${resolvedProduct.name} across top Singapore retailers including Lazada, Shopee, Amazon SG, FairPrice, and Courts.`,
    url: toSiteUrl(`/products/sg/${resolvedProduct.slug}`),
    offers: {
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
      { "@type": "ListItem", position: 2, name: "Products", item: "https://buywhere.ai/compare/" },
      { "@type": "ListItem", position: 3, name: resolvedProduct.name },
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
        <main className="flex-1">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              {resolvedProduct.name}
            </h1>
            <p className="text-lg text-gray-600 mb-8">
              Compare prices for {resolvedProduct.name} across top Singapore and Southeast Asia retailers.
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
