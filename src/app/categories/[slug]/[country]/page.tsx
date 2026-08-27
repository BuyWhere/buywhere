import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CATEGORY_SITEMAP_COUNTRIES,
  formatCategoryName,
  getApiCategoryBySlug,
  SITEMAP_BASE_URL,
} from "@/lib/sitemaps";

interface PageProps {
  params: Promise<{ slug: string; country: string }>;
}

const COUNTRY_LABELS: Record<string, string> = {
  us: "United States",
  sg: "Singapore",
  my: "Malaysia",
  th: "Thailand",
  id: "Indonesia",
  ph: "Philippines",
  vn: "Vietnam",
};

function isSupportedCountry(country: string): country is (typeof CATEGORY_SITEMAP_COUNTRIES)[number] {
  return CATEGORY_SITEMAP_COUNTRIES.includes(
    country as (typeof CATEGORY_SITEMAP_COUNTRIES)[number]
  );
}

function categoryUrl(slug: string, country: string) {
  return `${SITEMAP_BASE_URL}/categories/${slug}/${country}`;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CategoryCountryPage({ params }: PageProps) {
  const { slug, country } = await params;
  const normalizedCountry = country.toLowerCase();
  if (!isSupportedCountry(normalizedCountry)) notFound();

  const category = await getApiCategoryBySlug(decodeURIComponent(slug));
  if (!category) notFound();

  const categoryName = formatCategoryName(category.slug, category.name);
  const countryLabel = COUNTRY_LABELS[normalizedCountry];
  const url = categoryUrl(category.slug, normalizedCountry);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${categoryName} in ${countryLabel}`,
    description: `Compare ${categoryName.toLowerCase()} products and prices available in ${countryLabel}.`,
    url,
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: SITEMAP_BASE_URL,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Categories",
          item: `${SITEMAP_BASE_URL}/categories`,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: categoryName,
          item: url,
        },
      ],
    },
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <section className="mx-auto max-w-5xl px-6 py-16">
        <nav className="mb-8 text-sm text-slate-600" aria-label="Breadcrumb">
          <a className="hover:text-slate-950" href="/">
            Home
          </a>
          <span className="mx-2">/</span>
          <a className="hover:text-slate-950" href="/categories">
            Categories
          </a>
          <span className="mx-2">/</span>
          <span>{categoryName}</span>
        </nav>

        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-indigo-600">
            {countryLabel} category
          </p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Compare {categoryName} prices in {countryLabel}
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
            Browse live BuyWhere catalog coverage for {categoryName.toLowerCase()} products,
            compare merchants, and discover regional price opportunities in {countryLabel}.
          </p>
          {typeof category.product_count === "number" && (
            <p className="mt-6 text-sm text-slate-500">
              API catalog coverage: {category.product_count.toLocaleString()} products.
            </p>
          )}
        </div>

        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          <a className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-indigo-300" href={`/search?q=${encodeURIComponent(categoryName)}`} rel="nofollow">
            <h2 className="font-semibold">Search products</h2>
            <p className="mt-2 text-sm text-slate-600">Find matching catalog items across BuyWhere.</p>
          </a>
          <a className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-indigo-300" href={`/best/${category.slug}`}>
            <h2 className="font-semibold">Best picks</h2>
            <p className="mt-2 text-sm text-slate-600">Review high-confidence recommendations for this category.</p>
          </a>
          <a className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-indigo-300" href={`/cheapest/${category.slug}`}>
            <h2 className="font-semibold">Cheapest deals</h2>
            <p className="mt-2 text-sm text-slate-600">Prioritize low-price opportunities and deal pages.</p>
          </a>
        </section>
      </section>
    </main>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, country } = await params;
  const normalizedCountry = country.toLowerCase();
  if (!isSupportedCountry(normalizedCountry)) notFound();

  const category = await getApiCategoryBySlug(decodeURIComponent(slug));
  if (!category) notFound();

  const categoryName = formatCategoryName(category.slug, category.name);
  const countryLabel = COUNTRY_LABELS[normalizedCountry];
  const title = `${categoryName} Prices in ${countryLabel} | BuyWhere`;
  const description = `Compare ${categoryName.toLowerCase()} products and prices available in ${countryLabel}.`;
  const url = categoryUrl(category.slug, normalizedCountry);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
    },
  };
}
