import Link from 'next/link';
import { buildCategoriesIndexMetadata } from '@/lib/seo-category-metadata';

export const metadata = buildCategoriesIndexMetadata();

const countries = [
  { code: 'SG', label: 'Singapore' },
  { code: 'US', label: 'United States' },
  { code: 'UK', label: 'United Kingdom' },
  { code: 'AU', label: 'Australia' },
  { code: 'PH', label: 'Philippines' },
  { code: 'MY', label: 'Malaysia' },
];

const categories = [
  { name: 'Electronics', count: '234K', slug: 'electronics' },
  { name: 'Fashion', count: '198K', slug: 'fashion' },
  { name: 'Home & Kitchen', count: '145K', slug: 'home-kitchen' },
  { name: 'Health & Beauty', count: '87K', slug: 'health-beauty' },
  { name: 'Sports & Outdoors', count: '62K', slug: 'sports-outdoors' },
  { name: 'Toys & Games', count: '54K', slug: 'toys-games' },
  { name: 'Books & Stationery', count: '41K', slug: 'books-stationery' },
  { name: 'Automotive', count: '38K', slug: 'automotive' },
  { name: 'Pet Supplies', count: '29K', slug: 'pet-supplies' },
  { name: 'Food & Beverages', count: '25K', slug: 'food-beverages' },
  { name: 'Grocery', count: '21K', slug: 'grocery' },
  { name: 'Baby Products', count: '18K', slug: 'baby-products' },
];

const schemaMarkup = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  '@id': 'https://buywhere.ai/#breadcrumb',
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: 'https://buywhere.ai',
    },
    {
      '@type': 'ListItem',
      position: 2,
      name: 'Categories',
      item: 'https://buywhere.ai/categories',
    },
  ],
};

export default function CategoriesPage() {
  return (
    <div className="min-h-[60vh] py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaMarkup) }}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-3">
            Browse BuyWhere Catalog
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            Search across 1M+ products in 6 countries
          </p>
        </div>

        <div className="mb-10">
          <div className="flex flex-wrap gap-2">
            {countries.map((country) => (
              <Link
                key={country.code}
                href={`/search?q=&country=${country.code}`}
                className="px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-700 hover:bg-indigo-100 hover:text-indigo-700 transition-colors dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-indigo-900 dark:hover:text-indigo-300"
              >
                {country.code}
              </Link>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <Link
              key={category.slug}
              href={`/categories/${category.slug}`}
              className="flex items-center justify-between p-5 rounded-xl border border-gray-100 hover:border-indigo-200 hover:shadow-md transition-all dark:border-gray-700 dark:hover:border-indigo-700"
            >
              <div>
                <span className="font-semibold text-gray-900 dark:text-white text-base">
                  {category.name}
                </span>
                <span className="block text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  {category.count} products
                </span>
              </div>
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                className="text-gray-400 flex-shrink-0"
              >
                <path
                  d="M7 4l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
