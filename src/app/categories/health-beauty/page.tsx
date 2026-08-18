import Link from 'next/link';
import { HeroSearch } from '@/components/HeroSearch';
import { buildSgCategoryMetadata } from '@/lib/seo-category-metadata';
import { toSiteUrl } from '@/lib/site-url';

export const metadata = buildSgCategoryMetadata(
  'Health & Beauty Singapore | Compare Best Prices on Skincare, Vitamins & Wellness',
  'Find the best health and beauty products in Singapore. Compare prices on skincare, makeup, vitamins, supplements, wellness, and personal care products.',
  'health-beauty'
);

const CATEGORY_URL = toSiteUrl('/categories/health-beauty');

export default function HealthBeautyCategoryPage() {
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
            name: "Health & Beauty",
            item: CATEGORY_URL
          }
        ]
      },
      {
        "@type": "CollectionPage",
        "@id": `${CATEGORY_URL}#collection`,
        name: "Health & Beauty Singapore | Compare Best Prices on Skincare, Vitamins & Wellness",
        description: "Find the best health and beauty products in Singapore. Compare prices on skincare, makeup, vitamins, supplements, wellness, and personal care products.",
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
          name: "Health & Beauty",
          description: "Skincare, makeup, vitamins, supplements, wellness products, and personal care essentials"
        },
        mainEntity: {
          "@type": "ItemList",
          name: "Health & Beauty Categories",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Skincare & Face Care" },
            { "@type": "ListItem", position: 2, name: "Vitamins & Supplements" },
            { "@type": "ListItem", position: 3, name: "Hair Care" },
            { "@type": "ListItem", position: 4, name: "Makeup & Cosmetics" },
            { "@type": "ListItem", position: 5, name: "Personal Care" },
            { "@type": "ListItem", position: 6, name: "Wellness & Fitness" },
            { "@type": "ListItem", position: 7, name: "Men Grooming" },
            { "@type": "ListItem", position: 8, name: "Beauty Devices" }
          ]
        }
      }
    ]
  };

  return (
    <main id="main-content" className="min-h-[60vh] py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaMarkup) }}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Health & Beauty Singapore | Compare Best Prices on Skincare, Vitamins & Wellness
          </h1>
          <p className="text-lg text-gray-600 mb-6">
            Looking for health and beauty products in Singapore? BuyWhere brings together skincare, makeup, supplements, hair care, and personal care listings so you can compare prices and find trusted retailers faster.
          </p>
          <HeroSearch />
        </div>

        {/* Why Compare Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Why Compare Health & Beauty Prices on BuyWhere?</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🔄
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Real-time Price Comparison</h3>
              </div>
              <p className="text-gray-600">
                Compare prices from pharmacies, beauty specialty stores, department stores, and online-only stores across Singapore
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
                From daily essentials like cleansers and shampoo to premium serums and supplements, we index products across all price segments
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
                All retailers are vetted for authenticity and customer service quality
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
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Featured Health & Beauty Categories</h2>
          <p className="text-lg text-gray-600 mb-8">
            Browse our most popular health and beauty categories in Singapore:
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Skincare & Face Care</h3>
              <p className="text-gray-600">
                Cleansers, moisturizers, serums, sunscreen, and masks
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Vitamins & Supplements</h3>
              <p className="text-gray-600">
                Multivitamins, fish oil, collagen, and herbal supplements
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Hair Care</h3>
              <p className="text-gray-600">
                Shampoo, conditioner, hair treatments, and styling products
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Makeup & Cosmetics</h3>
              <p className="text-gray-600">
                Foundation, lipstick, eyeshadow, mascara, and beauty tools
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Personal Care</h3>
              <p className="text-gray-600">
                Soap, body wash, deodorant, dental care, and intimate care
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Wellness & Fitness</h3>
              <p className="text-gray-600">
                Protein powder, sports nutrition, and health monitors
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Men Grooming</h3>
              <p className="text-gray-600">
                Shaving, beard care, fragrance, and grooming tools
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Beauty Devices</h3>
              <p className="text-gray-600">
                Facial cleansing devices, hair dryers, straighteners, and trimmers
              </p>
            </div>
          </div>
        </section>

        {/* Best Deals Section */}
        <section className="mb-16 bg-gray-50">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Best Health & Beauty Deals in Singapore</h2>
          <p className="text-lg text-gray-600 mb-8">
            Health and beauty products are often promoted across pharmacies, specialist stores, department stores, and marketplaces. BuyWhere helps you spot price differences and current deals in one place.
          </p>
          <p className="text-lg text-gray-600 mb-6">
            Whether you are restocking everyday personal care or investing in a premium skincare routine, BuyWhere helps you make informed purchasing decisions.
          </p>
          <Link href="/search?q=health-beauty&region=sg" className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            Browse Health & Beauty Deals →
          </Link>
        </section>

        {/* FAQ Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Where can I find the best health & beauty deals in Singapore?</h3>
              <p className="text-gray-600">
                BuyWhere aggregates prices from major retailers in Singapore. Our comparison tool shows prices across department stores, specialty shops, and online platforms so you can find better value.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Are health and beauty prices in Singapore inclusive of GST?</h3>
              <p className="text-gray-600">
                All prices on BuyWhere show both ex-GST and inclusive prices. Singapore&apos;s 9% GST is applied at checkout, and we help you see the true cost before purchase.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Which retailer has the best health and beauty prices in Singapore?</h3>
              <p className="text-gray-600">
                Prices vary by product and retailer. Our data shows that pharmacies and online marketplaces often beat specialty stores on popular brands, while member promotions at beauty chains can offer better value on full routines.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Can I compare prices for travel-size or value packs?</h3>
              <p className="text-gray-600">
                Currently, BuyWhere focuses on new products from authorized retailers. We are working on adding certified refurbished listings from approved sellers.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">How often are health and beauty prices updated on BuyWhere?</h3>
              <p className="text-gray-600">
                Update cadence can vary by source and product. Check the current product detail and docs surfaces for the latest publicly documented availability and freshness guidance before making time-sensitive purchasing decisions.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Do health and beauty retailers deliver to all of Singapore?</h3>
              <p className="text-gray-600">
                BuyWhere shows product availability by retailer. Delivery options vary by retailer — most offer island-wide delivery within 1-3 business days.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center py-12">
          <p className="text-lg text-gray-600 mb-6">
            Start comparing health & beauty prices in Singapore today and find the best deals across major retailers.
          </p>
          <Link href="/search?q=health-beauty&region=sg" className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
            Compare Health & Beauty Prices Now →
          </Link>
        </section>
      </div>
    </main>
  );
}
