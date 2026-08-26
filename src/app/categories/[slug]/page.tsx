import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HeroSearch } from '@/components/HeroSearch';
import { PRODUCT_TAXONOMY, getCategoryBySlug } from '@/lib/taxonomy';
import { toSiteUrl } from '@/lib/site-url';
import CategorySsrProductGrid from '@/components/seo/CategorySsrProductGrid';

function slugToQuery(slug: string): string {
  return slug.replace(/-/g, '+');
}

function buildMetadata(slug: string): Metadata {
  const category = getCategoryBySlug(slug);
  if (!category) return { title: 'Category Not Found' };

  const name = category.name;
  const description = category.description
    ? `Compare ${name.toLowerCase()} prices in Singapore. Find the best deals from top retailers on BuyWhere. ${category.description}.`
    : `Compare ${name.toLowerCase()} prices in Singapore. Find the best deals from top retailers on BuyWhere. Updated daily with the latest prices.`;
  const title = `${name} Singapore | Compare Best Prices & Deals`;
  const canonical = toSiteUrl(`/categories/${slug}`);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'website',
      siteName: 'BuyWhere',
      locale: 'en_SG',
      images: [
        {
          url: '/og-image.png',
          width: 1200,
          height: 630,
          alt: `${name} - Compare prices on BuyWhere`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return buildMetadata(slug);
}

// Only categories in PRODUCT_TAXONOMY are valid; unknown slugs return a real 404
// (not a 200 'Category Not Found' soft-404 stub).
export const dynamicParams = false;

export function generateStaticParams() {
  return PRODUCT_TAXONOMY.map((cat) => ({ slug: cat.slug }));
}

export default async function CategorySlugPage({ params }: PageProps) {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);
  if (!category) notFound();

  const name = category.name;
  const canonicalCategoryUrl = toSiteUrl(`/categories/${slug}`);

  const schemaMarkup = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        '@id': `${toSiteUrl('/#breadcrumb')}`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: toSiteUrl('/') },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Categories',
            item: toSiteUrl('/categories/'),
          },
          {
            '@type': 'ListItem',
            position: 3,
            name,
            item: canonicalCategoryUrl,
          },
        ],
      },
      {
        '@type': 'CollectionPage',
        '@id': `${canonicalCategoryUrl}#collection`,
        name: `${name} Singapore | Compare Best Prices & Deals`,
        description: `Find the best ${name.toLowerCase()} in Singapore. Compare prices from top retailers on BuyWhere.`,
        url: canonicalCategoryUrl,
        mainEntityOfPage: canonicalCategoryUrl,
        publisher: {
          '@type': 'Organization',
          '@id': `${toSiteUrl('/#organization')}`,
          name: 'BuyWhere',
          url: toSiteUrl('/'),
        },
        about: {
          '@type': 'Thing',
          name,
          description: category.description,
        },
      },
    ],
  };

  return (
    <div className="min-h-[60vh] py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaMarkup) }}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            {name} Singapore | Compare Best Prices &amp; Deals
          </h1>
          <p className="text-lg text-gray-600 mb-6">
            Looking for the best {name.toLowerCase()} in Singapore? BuyWhere
            aggregates product listings from hundreds of retailers so you can
            compare prices, specs, and availability all in one place.
          </p>
          <HeroSearch />
        </div>

        {/* SSR product grid for crawlers */}
        <CategorySsrProductGrid
          title={`${name} products with live prices`}
          description={`Server-rendered ${name.toLowerCase()} results from the BuyWhere catalog, with current prices, retailer names, and sponsored merchant links visible to AI crawlers.`}
          query={name}
          category={slug}
          country="SG"
          pagePath={`/categories/${slug}`}
        />

        {/* We're building section */}
        <div className="mb-16 bg-indigo-50 border border-indigo-100 rounded-xl p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            We are building our {name.toLowerCase()} catalog
          </h2>
          <p className="text-lg text-gray-600 mb-6">
            Search for specific products or browse our categories below to find
            the best deals.
          </p>
          <Link
            href={`/search?q=${slugToQuery(slug)}&region=sg`} rel="nofollow"
            className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
          >
            Search {name} Now →
          </Link>
        </div>

        {/* Cross-category links */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">
            Browse All Categories
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            Explore our full range of product categories:
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {PRODUCT_TAXONOMY.map((cat) => (
              <Link
                key={cat.id}
                href={`/categories/${cat.slug}`}
                className={`p-6 rounded-xl border hover:shadow-md transition-shadow ${
                  cat.slug === slug
                    ? 'border-indigo-300 bg-indigo-50'
                    : 'border-gray-100'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{cat.icon}</span>
                  <h3 className="font-semibold text-gray-900">{cat.name}</h3>
                </div>
                <p className="text-gray-600 text-sm">{cat.description}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="text-center py-12">
          <p className="text-lg text-gray-600 mb-6">
            Start comparing {name.toLowerCase()} prices in Singapore today.
          </p>
          <Link
            href={`/search?q=${slugToQuery(slug)}&region=sg`} rel="nofollow"
            className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
          >
            Compare {name} Prices Now →
          </Link>
        </section>
      </div>
    </div>
  );
}
