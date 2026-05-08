import Link from 'next/link';
import type { Metadata } from 'next';
import { HeroSearch } from '@/components/HeroSearch';
import { PRODUCT_TAXONOMY, getCategoryBySlug } from '@/lib/taxonomy';

const BASE_URL = 'https://buywhere.ai';

function slugToName(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function slugToQuery(slug: string): string {
  return slug.replace(/-/g, '+');
}

function buildMetadata(slug: string): Metadata {
  const category = getCategoryBySlug(slug);
  const name = category?.name ?? slugToName(slug);
  const description = category?.description
    ? `Compare ${name.toLowerCase()} prices in Singapore. Find the best deals from top retailers on BuyWhere. ${category.description}.`
    : `Compare ${name.toLowerCase()} prices in Singapore. Find the best deals from top retailers on BuyWhere. Updated daily with the latest prices.`;
  const title = `${name} Singapore | Compare Best Prices & Deals`;
  const canonical = `${BASE_URL}/categories/${slug}`;

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

export default async function CategorySlugPage({ params }: PageProps) {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);
  const name = category?.name ?? slugToName(slug);

  const schemaMarkup = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        '@id': `${BASE_URL}/#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Categories',
            item: `${BASE_URL}/categories`,
          },
          {
            '@type': 'ListItem',
            position: 3,
            name,
            item: `${BASE_URL}/categories/${slug}`,
          },
        ],
      },
      {
        '@type': 'CollectionPage',
        '@id': `${BASE_URL}/categories/${slug}#collection`,
        name: `${name} Singapore | Compare Best Prices & Deals`,
        description: `Find the best ${name.toLowerCase()} in Singapore. Compare prices from top retailers on BuyWhere.`,
        url: `${BASE_URL}/categories/${slug}`,
        mainEntityOfPage: `${BASE_URL}/categories/${slug}`,
        publisher: {
          '@type': 'Organization',
          '@id': `${BASE_URL}/#organization`,
          name: 'BuyWhere',
          url: BASE_URL,
        },
        about: {
          '@type': 'Thing',
          name,
          description: category?.description ?? `${name} products and deals in Singapore`,
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
            href={`/search?q=${slugToQuery(slug)}&region=sg`}
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
            href={`/search?q=${slugToQuery(slug)}&region=sg`}
            className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
          >
            Compare {name} Prices Now →
          </Link>
        </section>
      </div>
    </div>
  );
}
