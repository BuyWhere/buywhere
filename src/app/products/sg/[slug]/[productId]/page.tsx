import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSeoLandingFallbackProduct } from "@/lib/seo-landing-pages";

interface ProductDetail {
  id: string | number;
  title?: string;
  name?: string;
  description?: string;
  price?: number;
  image_url?: string | null;
  category?: string;
  brand?: string;
  merchant_id?: string;
  merchant_name?: string;
  data_updated_at?: string;
}

function landingProductToDetail(product: ReturnType<typeof getSeoLandingFallbackProduct>): ProductDetail | null {
  if (!product) return null;

  return {
    id: product.id,
    name: product.name,
    description: `${product.name} is available from ${product.merchant}. Compare current pricing and merchant options on BuyWhere.`,
    price: product.price ?? undefined,
    image_url: product.imageUrl,
    category: product.category ?? undefined,
    brand: product.brand ?? undefined,
    merchant_name: product.merchant,
  };
}

async function getProduct(
  productId: string,
  merchantSlug: string
): Promise<ProductDetail | null> {
  const baseUrl =
    process.env.BUYWHERE_API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
    "https://api.buywhere.ai";
  const apiKey =
    process.env.BUYWHERE_API_KEY ||
    process.env.NEXT_PUBLIC_BUYWHERE_API_KEY ||
    "";
  const headers: Record<string, string> = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};

  try {
    const res = await fetch(`${baseUrl}/v1/products/${encodeURIComponent(productId)}`, {
      headers,
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json() as { data?: ProductDetail[] };
      const data = json?.data?.[0];
      if (data?.id != null) return data;
    }
  } catch {}

  return landingProductToDetail(getSeoLandingFallbackProduct("sg", productId, merchantSlug));
}

interface PageProps {
  params: { slug: string; productId: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug: merchantSlug, productId } = params;

  const product = await getProduct(productId, merchantSlug);
  if (!product) {
    return { title: "Product Not Found" };
  }

  const productName = product.name ?? product.title ?? `Product ${productId}`;
  const merchantName = product.merchant_name ?? merchantSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const canonicalUrl = `https://buywhere.ai/products/sg/${merchantSlug}/${productId}/`;

  return {
    title: `${productName} — ${merchantName} | BuyWhere SG`,
    description: product.description
      ? product.description.slice(0, 160)
      : `Buy ${productName} from ${merchantName} in Singapore. Compare prices and find the best deals on BuyWhere.`,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${productName} — ${merchantName} | BuyWhere SG`,
      description: `Buy ${productName} from ${merchantName} in Singapore.`,
      url: canonicalUrl,
      type: "website",
      images: product.image_url
        ? [{ url: product.image_url, width: 800, height: 800, alt: productName }]
        : [{ url: "/og-image.png", width: 1200, height: 630, alt: productName }],
    },
  };
}

export default async function SGProductDetailPage({ params }: PageProps) {
  const { slug: merchantSlug, productId } = params;

  const product = await getProduct(productId, merchantSlug);
  if (!product) {
    notFound();
  }

  const productName = product.name ?? product.title ?? `Product ${productId}`;
  const merchantName =
    product.merchant_name ??
    merchantSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const canonicalUrl = `https://buywhere.ai/products/sg/${merchantSlug}/${productId}/`;

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: productName,
    description:
      product.description ??
      `${productName} available from ${merchantName} in Singapore.`,
    url: canonicalUrl,
    ...(product.image_url && { image: product.image_url }),
    ...(product.brand && { brand: { "@type": "Brand", name: product.brand } }),
    ...(product.price != null && {
      offers: {
        "@type": "Offer",
        priceCurrency: "SGD",
        price: product.price,
        availability: "https://schema.org/InStock",
        seller: { "@type": "Organization", name: merchantName },
      },
    }),
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://buywhere.ai/" },
      {
        "@type": "ListItem",
        position: 2,
        name: `${merchantName} Products`,
        item: `https://buywhere.ai/sg/${merchantSlug}/products/`,
      },
      { "@type": "ListItem", position: 3, name: productName, item: canonicalUrl },
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
              <Link
                href={`/sg/${merchantSlug}/products/`}
                className="hover:text-indigo-600"
              >
                {merchantName}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-gray-900 font-medium line-clamp-1">
              {productName}
            </li>
          </ol>
        </nav>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {product.image_url && (
            <div className="aspect-square max-h-64 overflow-hidden bg-gray-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={product.image_url}
                alt={productName}
                className="w-full h-full object-contain p-4"
              />
            </div>
          )}

          <div className="p-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {productName}
            </h1>

            {product.brand && (
              <p className="text-sm text-gray-500 mb-4">
                by{" "}
                <span className="text-gray-700 font-medium">{product.brand}</span>
              </p>
            )}

            {product.price != null && (
              <div className="mb-4">
                <span className="text-3xl font-bold text-indigo-600">
                  SGD {Number(product.price).toFixed(2)}
                </span>
              </div>
            )}

            <p className="text-sm text-gray-600 mb-4">
              Available from{" "}
              <Link
                href={`/sg/${merchantSlug}/products/`}
                className="text-indigo-600 hover:underline"
              >
                {merchantName}
              </Link>{" "}
              in Singapore.
            </p>

            {product.description && (
              <div className="prose prose-sm text-gray-700 mt-4">
                <p>{product.description}</p>
              </div>
            )}

            {product.category && (
              <p className="mt-4 text-xs text-gray-400">
                Category: {product.category}
              </p>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
