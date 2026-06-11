import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

const VALID_REGIONS = new Set(["sg", "my", "ph", "th", "id", "vn"]);

interface MerchantInfo {
  id: string;
  name: string;
  country: string;
  is_active: boolean;
  onboarding_stage: string;
  description?: string;
  logo_url?: string | null;
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
    process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";
  const headers: Record<string, string> = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};

  try {
    // First try direct ID lookup
    const directRes = await fetch(
      `${baseUrl}/v1/merchants/${encodeURIComponent(merchantSlug)}`,
      { headers, next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) }
    );
    if (directRes.ok) {
      const data = (await directRes.json()) as MerchantInfo;
      if (data?.id) return data;
    }
  } catch {}

  try {
    // Fallback: fetch all ingested merchants for the country and match by slug
    const listRes = await fetch(
      `${baseUrl}/v1/merchants?country=${country.toUpperCase()}&onboarding_stage=ingested&is_active=true&limit=500`,
      { headers, next: { revalidate: 3600 }, signal: AbortSignal.timeout(10000) }
    );
    if (listRes.ok) {
      const data = (await listRes.json()) as {
        merchants?: MerchantInfo[];
      };
      const merchants = data.merchants ?? [];
      return merchants.find((m) => deriveMerchantSlug(m) === merchantSlug) ?? null;
    }
  } catch {}

  return null;
}

interface PageProps {
  params: Promise<{ "seo-page": string; merchant: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { "seo-page": region, merchant: merchantSlug } = await params;

  if (!VALID_REGIONS.has(region)) {
    return { title: "Page Not Found" };
  }

  const countryName: Record<string, string> = {
    sg: "Singapore",
    my: "Malaysia",
    ph: "Philippines",
    th: "Thailand",
    id: "Indonesia",
    vn: "Vietnam",
  };

  const merchant = await getMerchantBySlug(merchantSlug, region);
  if (!merchant) {
    return { title: "Merchant Not Found" };
  }

  const regionLabel = countryName[region] ?? region.toUpperCase();
  const canonicalUrl = `https://buywhere.ai/${region}/${merchantSlug}/products/`;

  return {
    title: `${merchant.name} Products in ${regionLabel} | BuyWhere`,
    description:
      merchant.description ??
      `Browse all products from ${merchant.name} in ${regionLabel}. Compare prices and find the best deals on BuyWhere.`,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${merchant.name} Products in ${regionLabel} | BuyWhere`,
      description: `Browse ${merchant.name} products in ${regionLabel}`,
      url: canonicalUrl,
      type: "website",
    },
  };
}

export default async function MerchantProductsPage({ params }: PageProps) {
  const { "seo-page": region, merchant: merchantSlug } = await params;

  if (!VALID_REGIONS.has(region)) {
    notFound();
  }

  const merchant = await getMerchantBySlug(merchantSlug, region);
  if (!merchant) {
    notFound();
  }

  const countryName: Record<string, string> = {
    sg: "Singapore",
    my: "Malaysia",
    ph: "Philippines",
    th: "Thailand",
    id: "Indonesia",
    vn: "Vietnam",
  };
  const regionLabel = countryName[region] ?? region.toUpperCase();
  const canonicalUrl = `https://buywhere.ai/${region}/${merchantSlug}/products/`;

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://buywhere.ai/" },
      {
        "@type": "ListItem",
        position: 2,
        name: `${merchant.name} Products`,
        item: canonicalUrl,
      },
    ],
  };

  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Store",
    name: merchant.name,
    url: canonicalUrl,
    ...(merchant.logo_url && { logo: merchant.logo_url }),
    areaServed: regionLabel,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
      />
      <main id="main-content" className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <nav aria-label="breadcrumb" className="mb-6 text-sm text-gray-500">
          <ol className="flex items-center gap-2 flex-wrap">
            <li>
              <Link href="/" className="hover:text-indigo-600">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href={`/${region}`} className="hover:text-indigo-600">
                {regionLabel}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-gray-900 font-medium">{merchant.name} Products</li>
          </ol>
        </nav>

        <header className="mb-8">
          {merchant.logo_url && (
            <div className="mb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={merchant.logo_url}
                alt={`${merchant.name} logo`}
                className="h-16 w-auto object-contain"
              />
            </div>
          )}
          <h1 className="text-3xl font-bold text-gray-900">
            {merchant.name} Products
          </h1>
          <p className="mt-2 text-gray-600">
            Browse all products from {merchant.name} available in {regionLabel}.
          </p>
        </header>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
          <p className="text-gray-500">
            Product listings coming soon. Check back shortly for the full catalogue.
          </p>
          <p className="mt-3 text-sm text-gray-400">
            Merchant: {merchant.name} &middot; Region: {regionLabel}
          </p>
        </div>
      </main>
    </>
  );
}
