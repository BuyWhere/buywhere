import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

const VALID_REGIONS = new Set(["sg", "us", "my", "ph", "th", "id", "vn"]);

const COUNTRY_NAMES: Record<string, string> = {
  sg: "Singapore",
  us: "United States",
  my: "Malaysia",
  ph: "Philippines",
  th: "Thailand",
  id: "Indonesia",
  vn: "Vietnam",
};

interface MerchantInfo {
  id: string;
  name: string;
  country: string;
  is_active?: boolean;
  onboarding_stage?: string;
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

function slugToDisplayName(slug: string): string {
  return slug
    .replace(/-sg$|-my$|-ph$|-th$|-id$|-vn$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Lookup merchant by slug.
 * Returns MerchantInfo if found, null if API unavailable/auth error, undefined if explicitly not found.
 */
async function getMerchantBySlug(
  merchantSlug: string,
  country: string
): Promise<MerchantInfo | null | undefined> {
  const baseUrl =
    process.env.BUYWHERE_API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_BUYWHERE_API_URL ||
    "https://api.buywhere.ai";
  const apiKey =
    process.env.BUYWHERE_API_KEY || process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";
  const headers: Record<string, string> = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};

  // Primary: fetch all ingested merchants for the country and match by derived slug.
  // The merchant ID in the API is the full domain (e.g. www.watsons.com.sg), not the slug.
  // The derived slug (watsons-sg) will NOT match a direct ID lookup, so we always use the list.
  try {
    const listRes = await fetch(
      `${baseUrl}/v1/merchants?country=${country.toUpperCase()}&onboarding_stage=ingested&is_active=true&limit=500`,
      { headers, next: { revalidate: 3600 }, signal: AbortSignal.timeout(10000) }
    );
    if (listRes.ok) {
      const data = (await listRes.json()) as { merchants?: MerchantInfo[] };
      const merchants = data.merchants ?? [];
      const match = merchants.find((m) => deriveMerchantSlug(m) === merchantSlug);
      // List API succeeded — if no match, the merchant genuinely doesn't exist
      return match ?? undefined;
    }
    // Auth error, 5xx, etc. — fall through to null (unknown, not absent)
  } catch {}

  // API unavailable — return null so the page renders with slug-derived name
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

  const regionLabel = COUNTRY_NAMES[region] ?? region.toUpperCase();
  const merchant = await getMerchantBySlug(merchantSlug, region);

  // When API is unavailable (null) or merchant absent (undefined), still render the page
  // with a meaningful title so Googlebot doesn't get a noindex signal.
  const displayName = merchant?.name ?? slugToDisplayName(merchantSlug);
  // Canonical (no trailing slash) — matches the on-disk route and the
  // URL emitted by the merchant/product sitemaps. Trailing-slash URLs
  // get rewritten via x-middleware-rewrite which GSC still reports as
  // "Page with redirect" (BUY-42727, BUY-41940, BUY-40084).
  const canonicalUrl = `https://buywhere.ai/${region}/${merchantSlug}/products`;

  return {
    title: `${displayName} Products in ${regionLabel} | BuyWhere`,
    description:
      merchant?.description ??
      `Browse all products from ${displayName} in ${regionLabel}. Compare prices and find the best deals on BuyWhere.`,
    // BUY-57869: thin "coming soon" placeholder pages — noindex until the
    // real catalog lands.  Allows crawlers to follow links off-page so the
    // merchant + region hubs still get discovered.
    robots: { index: false, follow: true },
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${displayName} Products in ${regionLabel} | BuyWhere`,
      description: `Browse ${displayName} products in ${regionLabel}`,
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

  // merchant is null (API unavailable), undefined (not found), or a MerchantInfo object.
  // When API is unavailable (null), render with slug-derived name so the page is
  // indexable — this avoids soft-404 for the sitemap merchant listing URLs
  // (BUY-37819). When genuinely absent (undefined), still render, not notFound(),
  // so Googlebot can discover the URL without a soft-404 signal.
  const regionLabel = COUNTRY_NAMES[region] ?? region.toUpperCase();
  const displayName = merchant?.name ?? slugToDisplayName(merchantSlug);
  // See canonicalUrl comment in generateMetadata above.
  const canonicalUrl = `https://buywhere.ai/${region}/${merchantSlug}/products`;

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://buywhere.ai/" },
      {
        "@type": "ListItem",
        position: 2,
        name: `${displayName} Products`,
        item: canonicalUrl,
      },
    ],
  };

  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Store",
    name: displayName,
    url: canonicalUrl,
    ...(merchant?.logo_url && { logo: merchant.logo_url }),
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
            <li className="text-gray-900 font-medium">{displayName} Products</li>
          </ol>
        </nav>

        <header className="mb-8">
          {merchant?.logo_url && (
            <div className="mb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={merchant.logo_url}
                alt={`${displayName} logo`}
                className="h-16 w-auto object-contain"
              />
            </div>
          )}
          <h1 className="text-3xl font-bold text-gray-900">
            {displayName} Products
          </h1>
          <p className="mt-2 text-gray-600">
            Browse all products from {displayName} available in {regionLabel}.
          </p>
        </header>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
          <p className="text-gray-500">
            Product listings coming soon. Check back shortly for the full catalogue.
          </p>
          <p className="mt-3 text-sm text-gray-400">
            Merchant: {displayName} &middot; Region: {regionLabel}
          </p>
        </div>
      </main>
    </>
  );
}
