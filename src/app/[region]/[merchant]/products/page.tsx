import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

const VALID_REGIONS = new Set(["sg", "my", "ph", "th", "id", "vn"]);

interface MerchantInfo {
  id: string;
  name: string;
  country: string;
  source: string;
  onboarding_stage: string;
  is_active: boolean;
}

interface Product {
  id: string | number;
  title?: string;
  name?: string;
  price?: number;
}

function deriveMerchantSlug(merchant: MerchantInfo): string {
  const id = merchant.id;
  const country = merchant.country.toLowerCase();
  if (id.includes(".")) {
    const cleaned = id.replace(/^www\./, "");
    const mainPart = cleaned.split(".")[0].toLowerCase();
    return `${mainPart}-${country}`;
  }
  const nameSlug = merchant.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${nameSlug}-${country}`;
}

async function getMerchantBySlug(
  merchantSlug: string,
  country: string
): Promise<MerchantInfo | null> {
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

  // Try direct ID lookup (works when slug == merchant id)
  try {
    const res = await fetch(
      `${baseUrl}/v1/merchants/${encodeURIComponent(merchantSlug)}`,
      {
        headers,
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (res.ok) {
      const data = (await res.json()) as MerchantInfo;
      if (data?.id) return data;
    }
  } catch {}

  // Fetch ingested merchants for this country and match by derived slug
  try {
    let offset = 0;
    const limit = 200;
    for (let page = 0; page < 5; page++) {
      const res = await fetch(
        `${baseUrl}/v1/merchants?country=${country.toUpperCase()}&onboarding_stage=ingested&limit=${limit}&offset=${offset}`,
        {
          headers,
          next: { revalidate: 3600 },
          signal: AbortSignal.timeout(6000),
        }
      );
      if (!res.ok) break;
      const data = (await res.json()) as {
        merchants?: MerchantInfo[];
        has_more?: boolean;
      };
      const merchants = data.merchants ?? [];
      const match = merchants.find((m) => deriveMerchantSlug(m) === merchantSlug);
      if (match) return match;
      if (!data.has_more || merchants.length < limit) break;
      offset += limit;
    }
  } catch {}

  return null;
}

async function getMerchantProducts(
  merchantId: string,
  countryCode: string
): Promise<Product[]> {
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
    const res = await fetch(
      `${baseUrl}/v1/products?country_code=${countryCode.toUpperCase()}&merchant_id=${encodeURIComponent(merchantId)}&limit=48`,
      {
        headers,
        next: { revalidate: 1800 },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (res.ok) {
      const data = (await res.json()) as { data?: Product[] };
      return Array.isArray(data.data) ? data.data : [];
    }
  } catch {}

  return [];
}

interface PageProps {
  params: { region: string; merchant: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { region, merchant } = params;
  if (!VALID_REGIONS.has(region.toLowerCase())) {
    return { title: "Not Found" };
  }

  const merchantInfo = await getMerchantBySlug(merchant, region);
  const merchantName =
    merchantInfo?.name ??
    merchant
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const regionLabel = region.toUpperCase();
  const canonicalUrl = `https://buywhere.ai/${region}/${merchant}/products/`;

  return {
    title: `${merchantName} Products — BuyWhere ${regionLabel}`,
    description: `Browse all products from ${merchantName} in ${regionLabel}. Compare prices and find the best deals on BuyWhere.`,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${merchantName} Products — BuyWhere ${regionLabel}`,
      description: `Browse all products from ${merchantName} in ${regionLabel}.`,
      url: canonicalUrl,
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: `${merchantName} on BuyWhere`,
        },
      ],
    },
  };
}

export default async function MerchantProductsPage({ params }: PageProps) {
  const { region, merchant } = params;

  if (!VALID_REGIONS.has(region.toLowerCase())) {
    notFound();
  }

  const merchantInfo = await getMerchantBySlug(merchant, region);
  if (!merchantInfo) {
    notFound();
  }

  const products = await getMerchantProducts(merchantInfo.id, region);
  const merchantName = merchantInfo.name;
  const regionLabel = region.toUpperCase();

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://buywhere.ai/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: `${merchantName} Products`,
        item: `https://buywhere.ai/${region}/${merchant}/products/`,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <main
        id="main-content"
        className="max-w-6xl mx-auto px-4 sm:px-6 py-8"
      >
        <nav aria-label="breadcrumb" className="mb-6 text-sm text-gray-500">
          <ol className="flex items-center gap-2 flex-wrap">
            <li>
              <Link href="/" className="hover:text-indigo-600">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-gray-900 font-medium">{merchantName}</li>
          </ol>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {merchantName} Products
          </h1>
          <p className="text-gray-600">
            Browse all products from {merchantName} available in{" "}
            {regionLabel}.
          </p>
        </header>

        {products.length > 0 ? (
          <section aria-label="Product listing">
            <ul
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
              role="list"
            >
              {products.map((product) => {
                const id = String(product.id);
                const name =
                  product.name ?? product.title ?? `Product ${id}`;
                return (
                  <li key={id} role="listitem">
                    <Link
                      href={`/products/${region}/${merchant}/${id}/`}
                      className="block border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
                    >
                      <p className="text-sm font-medium text-gray-900 line-clamp-2">
                        {name}
                      </p>
                      {product.price != null && (
                        <p className="mt-2 text-indigo-600 font-semibold text-sm">
                          ${Number(product.price).toFixed(2)}
                        </p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <section
            aria-label="Products coming soon"
            className="py-16 text-center border border-dashed border-gray-200 rounded-xl"
          >
            <p className="text-gray-500 text-lg">
              Products from {merchantName} are being indexed. Check back soon.
            </p>
            <p className="text-gray-400 text-sm mt-2">
              We&apos;re working on adding {regionLabel} merchant inventory to BuyWhere.
            </p>
          </section>
        )}
      </main>
    </>
  );
}
