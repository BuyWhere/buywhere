import Link from 'next/link';
import { HeroSearch } from '@/components/HeroSearch';
import { buildSgCategoryMetadata } from '@/lib/seo-category-metadata';
import { toSiteUrl } from '@/lib/site-url';

export const metadata = buildSgCategoryMetadata(
  'Home & Kitchen Singapore | Compare Best Prices on Cookware, Appliances & Home Goods',
  'Find the best home and kitchen products in Singapore. Compare prices on cookware, small appliances, furniture, bedding, decor, and household essentials.',
  'home-kitchen'
);

const CATEGORY_URL = toSiteUrl('/categories/home-kitchen');

export default function HomeKitchenCategoryPage() {
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
            name: "Home & Kitchen",
            item: CATEGORY_URL
          }
        ]
      },
      {
        "@type": "CollectionPage",
        "@id": `${CATEGORY_URL}#collection`,
        name: "Home & Kitchen Singapore | Compare Best Prices on Cookware, Appliances & Home Goods",
        description: "Find the best home and kitchen products in Singapore. Compare prices on cookware, small appliances, furniture, bedding, decor, and household essentials.",
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
          name: "Home & Kitchen",
          description: "Cookware, small kitchen appliances, furniture, bedding, home decor, and household essentials"
        },
        mainEntity: {
          "@type": "ItemList",
          name: "Home & Kitchen Categories",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Cookware & Bakeware" },
            { "@type": "ListItem", position: 2, name: "Small Kitchen Appliances" },
            { "@type": "ListItem", position: 3, name: "Furniture" },
            { "@type": "ListItem", position: 4, name: "Bedding & Linens" },
            { "@type": "ListItem", position: 5, name: "Home Decor" },
            { "@type": "ListItem", position: 6, name: "Cleaning & Household" },
            { "@type": "ListItem", position: 7, name: "Dinnerware & Serveware" },
            { "@type": "ListItem", position: 8, name: "Organisation & Storage" }
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
            Home & Kitchen Singapore | Compare Best Prices on Cookware, Appliances & Home Goods
          </h1>
          <p className="text-lg text-gray-600 mb-6">
            Upgrading your home or kitchen in Singapore? BuyWhere helps compare prices on cookware, appliances, furniture, bedding, storage, and decor from major retailers and online stores.
          </p>
          <HeroSearch />
        </div>

        {/* Why Compare Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Why Compare Home & Kitchen Prices on BuyWhere?</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🔄
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Real-time Price Comparison</h3>
              </div>
              <p className="text-gray-600">
                Compare prices from department stores, furniture stores, specialty kitchen shops, and online-only stores across Singapore
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
                From everyday cookware and storage to large appliances and furniture, we index products across all price segments
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
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Featured Home & Kitchen Categories</h2>
          <p className="text-lg text-gray-600 mb-8">
            Browse our most popular home and kitchen categories in Singapore:
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Cookware & Bakeware</h3>
              <p className="text-gray-600">
                Pots, pans, baking tins, and cooking utensils
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Small Kitchen Appliances</h3>
              <p className="text-gray-600">
                Air fryers, rice cookers, blenders, coffee machines, and toasters
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Furniture</h3>
              <p className="text-gray-600">
                Sofas, tables, chairs, storage units, and office furniture
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Bedding & Linens</h3>
              <p className="text-gray-600">
                Mattresses, pillows, bedsheets, towels, and curtains
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Home Decor</h3>
              <p className="text-gray-600">
                Vases, picture frames, wall art, rugs, and decorative accessories
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Cleaning & Household</h3>
              <p className="text-gray-600">
                Vacuum cleaners, mops, laundry supplies, and storage solutions
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Dinnerware & Serveware</h3>
              <p className="text-gray-600">
                Plates, bowls, glasses, cutlery, and serving trays
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Organisation & Storage</h3>
              <p className="text-gray-600">
                Shelves, boxes, baskets, wardrobe organizers, and hooks
              </p>
            </div>
          </div>
        </section>

        {/* Best Deals Section */}
        <section className="mb-16 bg-gray-50">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Best Home & Kitchen Deals in Singapore</h2>
          <p className="text-lg text-gray-600 mb-8">
            Home and kitchen purchases can range from everyday storage to big-ticket appliances. BuyWhere lets shoppers compare retailers before making a purchase.
          </p>
          <p className="text-lg text-gray-600 mb-6">
            Whether you are furnishing a new home or upgrading a single appliance, BuyWhere helps you make informed purchasing decisions.
          </p>
          <Link href="/search?q=home-kitchen&region=sg" className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            Browse Home & Kitchen Deals →
          </Link>
        </section>

        {/* FAQ Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Where can I find the best home & kitchen deals in Singapore?</h3>
              <p className="text-gray-600">
                BuyWhere aggregates prices from major retailers in Singapore. Our comparison tool shows prices across department stores, specialty shops, and online platforms so you can find better value.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Are home and kitchen prices in Singapore inclusive of GST?</h3>
              <p className="text-gray-600">
                All prices on BuyWhere show both ex-GST and inclusive prices. Singapore&apos;s 9% GST is applied at checkout, and we help you see the true cost before purchase.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Which retailer has the best home and kitchen prices in Singapore?</h3>
              <p className="text-gray-600">
                Prices vary by product and retailer. Our data shows that online marketplaces often beat big box stores on small appliances, while bundle deals and floor sales at furniture stores can offer better value on larger purchases.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Can I compare prices for display sets or open-box items?</h3>
              <p className="text-gray-600">
                Currently, BuyWhere focuses on new products from authorized retailers. We are working on adding certified refurbished listings from approved sellers.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">How often are home and kitchen prices updated on BuyWhere?</h3>
              <p className="text-gray-600">
                Update cadence can vary by source and product. Check the current product detail and docs surfaces for the latest publicly documented availability and freshness guidance before making time-sensitive purchasing decisions.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Do home and kitchen retailers deliver to all of Singapore?</h3>
              <p className="text-gray-600">
                BuyWhere shows product availability by retailer. Delivery options vary by retailer — most offer island-wide delivery within 1-3 business days.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center py-12">
          <p className="text-lg text-gray-600 mb-6">
            Start comparing home & kitchen prices in Singapore today and find the best deals across major retailers.
          </p>
          <Link href="/search?q=home-kitchen&region=sg" className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
            Compare Home & Kitchen Prices Now →
          </Link>
        </section>
      </div>
    </main>
  );
}
