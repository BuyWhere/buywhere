import Link from 'next/link';
import { HeroSearch } from '@/components/HeroSearch';
import { buildSgCategoryMetadata } from '@/lib/seo-category-metadata';
import { toSiteUrl } from '@/lib/site-url';

export const metadata = buildSgCategoryMetadata(
  'Electronics Singapore | Compare Best Prices on Gadgets & Tech',
  'Find the best electronics in Singapore. Compare cheapest prices on smartphones, laptops, TVs, and more from top retailers. Updated daily with the latest deals.',
  'electronics'
);

const CATEGORY_URL = toSiteUrl('/categories/electronics');

export default function ElectronicsCategoryPage() {
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
            name: "Electronics",
            item: CATEGORY_URL
          }
        ]
      },
      {
        "@type": "CollectionPage",
        "@id": `${CATEGORY_URL}#collection`,
        name: "Electronics Singapore | Compare Best Prices on Gadgets & Tech",
        description: "Find the best electronics in Singapore. Compare cheapest prices on smartphones, laptops, TVs, and more from top retailers.",
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
          name: "Electronics",
          description: "Smartphones, laptops, TVs, gaming, cameras, and more"
        },
        mainEntity: {
          "@type": "ItemList",
          name: "Electronics Categories",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Mobile Phones & Tablets" },
            { "@type": "ListItem", position: 2, name: "Laptops & Computers" },
            { "@type": "ListItem", position: 3, name: "TVs & Home Entertainment" },
            { "@type": "ListItem", position: 4, name: "Gaming" },
            { "@type": "ListItem", position: 5, name: "Cameras & Photography" },
            { "@type": "ListItem", position: 6, name: "Smart Home Devices" },
            { "@type": "ListItem", position: 7, name: "Audio & Headphones" },
            { "@type": "ListItem", position: 8, name: "Wearables & Smartwatches" }
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
            Electronics Singapore | Compare Best Prices on Gadgets & Tech
          </h1>
          <p className="text-lg text-gray-600 mb-6">
            Looking for the best electronics in Singapore? BuyWhere aggregates product listings from hundreds of retailers so you can compare prices, specs, and availability all in one place. Whether you are hunting for the latest smartphone, upgrading your home entertainment system, or building a gaming PC, we help you find exactly what you need at the lowest prices.
          </p>
          <HeroSearch />
        </div>

        {/* Why Compare Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Why Compare Electronics Prices on BuyWhere?</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🔄
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Real-time Price Comparison</h3>
              </div>
              <p className="text-gray-600">
                Compare prices from Courts, Harvey Norman, Best Denki, Challenger, and online-only stores across Singapore
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  📦
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Wide Product Range</h3>
              </div>
              <p className="text-gray-600">
                From flagship smartphones to budget-friendly tablets, we index products across all price segments
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  ✅
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Verified Merchant Data</h3>
              </div>
              <p className="text-gray-600">
                The retailer is shown on every listing, so you can check authenticity and service before you buy
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  💰
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">GST-Compliant Listings</h3>
              </div>
              <p className="text-gray-600">
                Every product shows pre-GST and post-GST pricing for transparent shopping
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  📊
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Stock Availability Tracking</h3>
              </div>
              <p className="text-gray-600">
                See which products are in stock at which retailer before you visit
              </p>
            </div>
          </div>
        </section>

        {/* Featured Categories */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Featured Electronics Categories</h2>
          <p className="text-lg text-gray-600 mb-8">
            Browse our most popular electronics categories in Singapore:
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Mobile Phones &amp; Tablets</h3>
              <p className="text-gray-600">
                Apple iPhone, Samsung Galaxy, Google Pixel, Xiaomi, and more
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Laptops &amp; Computers</h3>
              <p className="text-gray-600">
                MacBooks, gaming laptops, desktops, and PC components
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">TVs &amp; Home Entertainment</h3>
              <p className="text-gray-600">
                Smart TVs, soundbars, streaming devices, and home theatre systems
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Gaming</h3>
              <p className="text-gray-600">
                PlayStation 5, Xbox Series X, Nintendo Switch, gaming headsets, and accessories
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Cameras &amp; Photography</h3>
              <p className="text-gray-600">
                DSLRs, mirrorless cameras, action cameras, and lenses
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Smart Home Devices</h3>
              <p className="text-gray-600">
                Amazon Echo, Google Nest, smart bulbs, security cameras, and robot vacuums
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Audio</h3>
              <p className="text-gray-600">
                Wireless earbuds, headphones, portable speakers, and hi-fi systems
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Wearables</h3>
              <p className="text-gray-600">
                Smartwatches, fitness trackers, and health monitoring devices
              </p>
            </div>
          </div>
        </section>

        {/* Best Deals Section */}
        <section className="mb-16 bg-gray-50">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Best Electronics Deals in Singapore</h2>
          <p className="text-lg text-gray-600 mb-8">
            Singapore&apos;s electronics market is competitive, with prices varying significantly between retailers. BuyWhere monitors prices from over 50 electronics retailers in Singapore, including major chains like Courts, Harvey Norman, and Best Denki, as well as online-first brands. Our users regularly save hundreds of dollars by comparing before they buy.
          </p>
          <p className="text-lg text-gray-600 mb-6">
            Whether you are a tech enthusiast seeking the latest flagship device or a budget-conscious shopper looking for the best value, BuyWhere helps you make informed purchasing decisions.
          </p>
          <Link href="/search?q=electronics&region=sg" rel="nofollow" className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            Browse Electronics Deals →
          </Link>
        </section>

        {/* FAQ Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Where can I find the cheapest electronics in Singapore?</h3>
              <p className="text-gray-600">
                BuyWhere aggregates prices from all major electronics retailers in Singapore. Our comparison tool shows you the lowest price available across Courts, Harvey Norman, Best Denki, Challenger, and online stores like Shopee and Lazada.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Are electronics prices in Singapore inclusive of GST?</h3>
              <p className="text-gray-600">
                All prices on BuyWhere show both ex-GST and inclusive prices. Singapore&apos;s 9% GST is applied at checkout, and we help you see the true cost before purchase.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Which electronics retailer has the best prices in Singapore?</h3>
              <p className="text-gray-600">
                Prices vary by product and retailer. Our data shows that online-only retailers like Challenger and standalone shops often beat the big box stores on specific items, while bundle deals at Courts and Harvey Norman can offer better value for home entertainment setups.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Can I compare prices for second-hand or refurbished electronics?</h3>
              <p className="text-gray-600">
                Currently, BuyWhere focuses on new products from authorized retailers. We are working on adding certified refurbished listings from approved sellers.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">How often are electronics prices updated on BuyWhere?</h3>
              <p className="text-gray-600">
                Update cadence can vary by source and product. Check the current product detail and docs surfaces for the latest publicly documented availability and freshness guidance before making time-sensitive purchasing decisions.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Do you ship electronics to all of Singapore?</h3>
              <p className="text-gray-600">
                BuyWhere shows product availability by retailer. Delivery options vary by retailer — most offer island-wide delivery within 1-3 business days.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center py-12">
          <p className="text-lg text-gray-600 mb-6">
            Start comparing electronics prices in Singapore today and find the best deals across all major retailers.
          </p>
          <Link href="/search?q=electronics&region=sg" rel="nofollow" className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
            Compare Electronics Prices Now →
          </Link>
        </section>
      </div>
    </div>
  );
}
