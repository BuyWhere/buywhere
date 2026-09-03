import Link from 'next/link';
import { HeroSearch } from '@/components/HeroSearch';
import { buildSgCategoryMetadata } from '@/lib/seo-category-metadata';
import { toSiteUrl } from '@/lib/site-url';

export const metadata = buildSgCategoryMetadata(
  'Home & Living Singapore | Compare Best Prices on Furniture & Household Items',
  'Shop home and living products in Singapore. Compare cheapest prices on furniture, kitchen appliances, bedding, and home decor from IKEA, Courts, and top retailers.',
  'home-living'
);

const CATEGORY_URL = toSiteUrl('/categories/home-living');

export default function HomeLivingCategoryPage() {
  const schemaMarkup = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        "@id": "https://buywhere.ai/#breadcrumb",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: toSiteUrl('/')
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Categories",
            item: toSiteUrl('/categories/')
          },
          {
            "@type": "ListItem",
            position: 3,
            name: "Home & Living",
            item: CATEGORY_URL
          }
        ]
      },
      {
        "@type": "CollectionPage",
        "@id": `${CATEGORY_URL}#collection`,
        name: "Home & Living Singapore | Compare Best Prices on Furniture & Household Items",
        description: "Shop home and living products in Singapore. Compare cheapest prices on furniture, kitchen appliances, bedding, and home decor from IKEA, Courts, and top retailers.",
        url: CATEGORY_URL,
        mainEntityOfPage: CATEGORY_URL,
        publisher: {
          "@type": "Organization",
          "@id": "https://buywhere.ai/#organization",
          name: "BuyWhere",
          url: toSiteUrl('/')
        },
        about: {
          "@type": "Thing",
          name: "Home & Living Products",
          description: "Furniture, kitchen appliances, bedding, and home decor"
        },
        mainEntity: {
          "@type": "ItemList",
          name: "Home & Living Categories",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Furniture" },
            { "@type": "ListItem", position: 2, name: "Kitchen Appliances" },
            { "@type": "ListItem", position: 3, name: "Bedding & Linen" },
            { "@type": "ListItem", position: 4, name: "Home Decor" },
            { "@type": "ListItem", position: 5, name: "Outdoor Furniture" },
            { "@type": "ListItem", position: 6, name: "Storage & Organization" },
            { "@type": "ListItem", position: 7, name: "Bathroom Accessories" },
            { "@type": "ListItem", position: 8, name: "Lighting" }
          ]
        }
      }
    ]
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
            Home & Living Singapore | Compare Best Prices on Furniture & Household Items
          </h1>
          <p className="text-lg text-gray-600 mb-6">
            Transform your living space without overspending. BuyWhere aggregates home and living product listings from furniture stores, kitchen appliance shops, bedding retailers, and home decor boutiques across Singapore. Whether you are moving into a new flat, renovating your HDB apartment, or simply refreshing your space, we help you find the best products at the best prices.
          </p>
          <HeroSearch />
        </div>

        {/* Why Compare Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Why Compare Home & Living Prices on BuyWhere?</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🛋️
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Furniture Price Comparison</h3>
              </div>
              <p className="text-gray-600">
                Compare prices on sofas, beds, dining sets, and storage solutions from IKEA, Courts, OG Furniture, and more
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🔌
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Appliance Deals</h3>
              </div>
              <p className="text-gray-600">
                Find the lowest prices on kitchen appliances, air conditioners, and home electronics
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🛏️
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Bedding &amp; Linen Selection</h3>
              </div>
              <p className="text-gray-600">
                Compare prices on mattresses, pillows, bed sheets, and towels
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🎨
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Home Decor Variety</h3>
              </div>
              <p className="text-gray-600">
                Discover decorative items, rugs, curtains, and wall art across multiple retailers
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🚚
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Delivery Cost Calculation</h3>
              </div>
              <p className="text-gray-600">
                See total costs including delivery and assembly fees
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  📍
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Stock Location Tracking</h3>
              </div>
              <p className="text-gray-600">
                Check product availability across different stores
              </p>
            </div>
          </div>
        </section>

        {/* Popular Categories */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Popular Home & Living Categories in Singapore</h2>
          <p className="text-lg text-gray-600 mb-8">
            Find everything you need for your home:
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Furniture</h3>
              <p className="text-gray-600">
                Sofas, beds, wardrobes, dining tables, chairs, and office furniture for every room
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Kitchen Appliances</h3>
              <p className="text-gray-600">
                Refrigerators, cookers, blenders, and air fryers
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Bedding &amp; Linen</h3>
              <p className="text-gray-600">
                Mattresses, pillows, bed sheets, and towels
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Home Decor</h3>
              <p className="text-gray-600">
                Rugs, curtains, wall art, and decorative items
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Outdoor Furniture</h3>
              <p className="text-gray-600">
                Patio sets, garden chairs, and outdoor decor
              </p>
            </div>
          </div>
        </section>

        {/* Best Deals Section */}
        <section className="mb-16 bg-gray-50 rounded-xl p-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Best Home & Living Deals in Singapore</h2>
          <p className="text-lg text-gray-600 mb-8">
            Singapore offers a wide range of home and living options, from IKEA&apos;s affordable Swedish designs to premium brands like Courts and Singtel. BuyWhere helps you compare prices across all major retailers so you can find the best deals on furniture, appliances, and home goods.
          </p>
          <Link href="/search?q=home+living&region=sg" rel="nofollow" className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            Browse Home & Living Deals →
          </Link>
        </section>

        {/* CTA */}
        <section className="text-center py-12 bg-indigo-600 text-white rounded-xl">
          <h2 className="text-3xl font-bold mb-4">Start Comparing Home & Living Prices</h2>
          <p className="text-lg text-indigo-200 mb-8 max-w-2xl mx-auto">
            Join thousands of Singapore households who use BuyWhere to find the best deals on furniture, appliances, and home goods.
          </p>
          <Link href="/compare/us" className="inline-flex items-center px-6 py-3 bg-white text-indigo-600 font-semibold rounded-lg hover:bg-indigo-50 transition-colors">
            Compare Prices Now →
          </Link>
        </section>
      </div>
    </div>
  );
}
