import Link from 'next/link';
import { HeroSearch } from '@/components/HeroSearch';
import { buildSgCategoryMetadata } from '@/lib/seo-category-metadata';
import { toSiteUrl } from '@/lib/site-url';

export const metadata = buildSgCategoryMetadata(
  'Grocery Singapore | Compare Prices on Food, Beverages & Daily Essentials',
  'Compare grocery prices in Singapore. Find cheapest deals on rice, cooking ingredients, snacks, beverages, and daily essentials from NTUC, Sheng Siong, Cold Storage, and more.',
  'grocery'
);

const CATEGORY_URL = toSiteUrl('/categories/grocery');

export default function GroceryCategoryPage() {
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
            name: "Grocery",
            item: CATEGORY_URL
          }
        ]
      },
      {
        "@type": "CollectionPage",
        "@id": `${CATEGORY_URL}#collection`,
        name: "Grocery Singapore | Compare Prices on Food, Beverages & Daily Essentials",
        description: "Compare grocery prices in Singapore. Find cheapest deals on rice, cooking ingredients, snacks, beverages, and daily essentials from NTUC, Sheng Siong, Cold Storage, and more.",
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
          name: "Grocery Products",
          description: "Food, beverages, and daily essentials"
        },
        mainEntity: {
          "@type": "ItemList",
          name: "Grocery Categories",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Rice & Grains" },
            { "@type": "ListItem", position: 2, name: "Cooking Ingredients" },
            { "@type": "ListItem", position: 3, name: "Fresh Produce" },
            { "@type": "ListItem", position: 4, name: "Dairy & Eggs" },
            { "@type": "ListItem", position: 5, name: "Snacks & Confectionery" },
            { "@type": "ListItem", position: 6, name: "Beverages" },
            { "@type": "ListItem", position: 7, name: "Frozen Foods" },
            { "@type": "ListItem", position: 8, name: "Household & Cleaning" }
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
            Grocery Singapore | Compare Prices on Food, Beverages & Daily Essentials
          </h1>
          <p className="text-lg text-gray-600 mb-6">
            Everyday savings add up. BuyWhere helps Singapore households compare grocery prices across major supermarkets and online grocery platforms, so you can make smarter choices at the checkout. From staple ingredients to premium imported goods, we index products across NTUC FairPrice, Sheng Siong, Cold Storage, Giant, and online-first grocery services.
          </p>
          <HeroSearch />
        </div>

        {/* Why Compare Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Why Compare Grocery Prices on BuyWhere?</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🛒
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Supermarket Price Comparison</h3>
              </div>
              <p className="text-gray-600">
                Compare prices on identical products across NTUC, Sheng Siong, Cold Storage, Giant, and more
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🔔
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Grocery Price Alerts</h3>
              </div>
              <p className="text-gray-600">
                Set alerts for when your favourite products go on promotion
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  ➗
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Unit Price Calculation</h3>
              </div>
              <p className="text-gray-600">
                Compare cost per kilogram or per litre to find true value
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🎫
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Promo Code Aggregation</h3>
              </div>
              <p className="text-gray-600">
                See all available promo codes and bundle deals in one view
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🌱
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Imported Goods Tracking</h3>
              </div>
              <p className="text-gray-600">
                Compare prices on imported items across different retailers
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  📅
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Seasonal Produce Prices</h3>
              </div>
              <p className="text-gray-600">
                Track price changes on fresh produce and seasonal ingredients
              </p>
            </div>
          </div>
        </section>

        {/* Popular Categories */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Popular Grocery Categories in Singapore</h2>
          <p className="text-lg text-gray-600 mb-8">
            Stock your pantry with the best deals:
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Rice &amp; Grains</h3>
              <p className="text-gray-600">
                Jasmine rice, basmati rice, brown rice, pasta, noodles, and quinoa
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Cooking Ingredients</h3>
              <p className="text-gray-600">
                Cooking oil, soy sauce, oyster sauce, curry paste, coconut milk, and spices
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Fresh Produce</h3>
              <p className="text-gray-600">
                Vegetables, fruits, herbs, and salad greens
              </p>
            </div>
          </div>
        </section>

        {/* Best Deals Section */}
        <section className="mb-16 bg-gray-50">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Best Grocery Deals in Singapore</h2>
          <p className="text-lg text-gray-600 mb-8">
            Singapore&apos;s supermarket competition is fierce, with NTUC FairPrice, Sheng Siong, Cold Storage, Giant, and online platforms like RedMart and FairPrice Online constantly vying for your basket. BuyWhere monitors prices and promotions across all major retailers, helping you identify the best deals on the products you buy every week.
          </p>
          <Link href="/search?q=grocery&region=sg" rel="nofollow" className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            Browse Grocery Deals →
          </Link>
        </section>

        {/* Singapore Grocery Retailers */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Singapore Grocery Retailers on BuyWhere</h2>
          <p className="text-lg text-gray-600 mb-8">
            Our platform compares products from NTUC FairPrice, Sheng Siong, Cold Storage, Giant, FairPrice Online, RedMart, and specialty importers. Whether you are doing your weekly wet market run or ordering groceries online, BuyWhere helps you find where to shop.
          </p>
        </section>

        {/* FAQ Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Which supermarket has the cheapest groceries in Singapore?</h3>
              <p className="text-gray-600">
                NTUC FairPrice generally offers the lowest prices on housebrand items and staples. Sheng Siong often has competitive prices on produce and specific items. BuyWhere comparison helps you find the best price on each product.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Are online grocery prices the same as in-store?</h3>
              <p className="text-gray-600">
                Not always. Online platforms may have exclusive promotions but also charge delivery fees. BuyWhere shows the total cost including delivery to help you compare accurately.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">How can I save money on groceries in Singapore?</h3>
              <p className="text-gray-600">
                Use the PriceBuddy app at NTUC FairPrice, collectlink promo codes, buy whole chickens instead of cut pieces, purchase housebrand items, and shop at wet markets for fresh produce. BuyWhere helps you identify the lowest price across all retailers.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Where can I find the cheapest rice in Singapore?</h3>
              <p className="text-gray-600">
                Rice prices vary significantly by brand and retailer. Check NTUC FairPrice for value options like Golden Coin rice, or specialty shops for premium varieties like Japanese short-grain rice.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Can I compare prices for imported specialty ingredients?</h3>
              <p className="text-gray-600">
                Yes. BuyWhere indexes imported ingredients from Cold Storage, FairPrice, and specialty Asian grocers, making it easy to find miso paste, coconut cream, and other recipe staples at the best price.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Do grocery retailers offer same-day delivery in Singapore?</h3>
              <p className="text-gray-600">
                Most major retailers offer same-day or next-day delivery for orders above a minimum threshold. FairPrice Online and RedMart have extensive coverage across Singapore.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center py-12">
          <p className="text-lg text-gray-600 mb-6">
            Find the best grocery deals in Singapore with BuyWhere.
          </p>
          <Link href="/search?q=grocery&region=sg" rel="nofollow" className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
            Compare Grocery Prices Now →
          </Link>
        </section>
      </div>
    </div>
  );
}
