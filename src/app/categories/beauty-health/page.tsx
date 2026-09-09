import Link from 'next/link';
import { HeroSearch } from '@/components/HeroSearch';
import { buildSgCategoryMetadata } from '@/lib/seo-category-metadata';
import { toSiteUrl } from '@/lib/site-url';

export const metadata = buildSgCategoryMetadata(
  'Beauty & Health Singapore | Compare Best Skincare, Makeup & Wellness Prices',
  'Find the best beauty products in Singapore. Compare cheapest prices on skincare, makeup, fragrances, and health supplements from Watsons, Guardian, Sephora, and more.',
  'beauty-health'
);

const CATEGORY_URL = toSiteUrl('/categories/beauty-health');

export default function BeautyHealthCategoryPage() {
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
            name: "Beauty & Health",
            item: CATEGORY_URL
          }
        ]
      },
      {
        "@type": "CollectionPage",
        "@id": `${CATEGORY_URL}#collection`,
        name: "Beauty & Health Singapore | Compare Best Skincare, Makeup & Wellness Prices",
        description: "Find the best beauty products in Singapore. Compare cheapest prices on skincare, makeup, fragrances, and health supplements from Watsons, Guardian, Sephora, and more.",
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
          name: "Beauty & Health Products",
          description: "Skincare, makeup, fragrances, hair care, and health supplements"
        },
        mainEntity: {
          "@type": "ItemList",
          name: "Beauty & Health Categories",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Skincare" },
            { "@type": "ListItem", position: 2, name: "Makeup" },
            { "@type": "ListItem", position: 3, name: "Fragrances" },
            { "@type": "ListItem", position: 4, name: "Hair Care" },
            { "@type": "ListItem", position: 5, name: "Health Supplements" },
            { "@type": "ListItem", position: 6, name: "Personal Care" },
            { "@type": "ListItem", position: 7, name: "Beauty Tools" },
            { "@type": "ListItem", position: 8, name: "Organic & Natural Beauty" }
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
            Beauty & Health Singapore | Compare Best Skincare, Makeup & Wellness Prices
          </h1>
          <p className="text-lg text-gray-600 mb-6">
            Singaporeans take their beauty and health seriously, and the market reflects that with an impressive range of products from global brands and local favourites. BuyWhere aggregates beauty and health product listings from retailers across Singapore, making it easy to compare prices on skincare, cosmetics, fragrances, hair care, and health supplements all in one place.
          </p>
          <HeroSearch />
        </div>

        {/* Why Compare Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Why Compare Beauty & Health Prices on BuyWhere?</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  📋
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Comprehensive Product Catalog</h3>
              </div>
              <p className="text-gray-600">
                From premium skincare serums to affordable daily essentials, we index thousands of beauty and health products
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🧪
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Ingredient Transparency</h3>
              </div>
              <p className="text-gray-600">
                Browse products with detailed ingredient lists and skin type recommendations
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  💧
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Price Per ML Comparison</h3>
              </div>
              <p className="text-gray-600">
                Calculate the true value of beauty products with our cost-per-use metrics
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  ✅
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Authenticity Verification</h3>
              </div>
              <p className="text-gray-600">
                The retailer is shown on every listing — check for authorized sellers before you buy
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  📦
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Stock Availability</h3>
              </div>
              <p className="text-gray-600">
                See which products are in stock at which retailer near you
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  ⭐
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Review Aggregation</h3>
              </div>
              <p className="text-gray-600">
                See aggregated customer reviews alongside product listings
              </p>
            </div>
          </div>
        </section>

        {/* Popular Categories */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Popular Beauty & Health Categories</h2>
          <p className="text-lg text-gray-600 mb-8">
            Discover products tailored to your needs:
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Skincare</h3>
              <p className="text-gray-600">
                Cleansers, toners, serums, moisturizers, sunscreen, and specialized treatments for every skin type
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Makeup</h3>
              <p className="text-gray-600">
                Foundations, lipsticks, eyeshadows, mascaras, and contouring products from top brands
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Fragrances</h3>
              <p className="text-gray-600">
                Designer perfumes, colognes, and body sprays for men and women
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Hair Care</h3>
              <p className="text-gray-600">
                Shampoos, conditioners, hair treatments, and styling products
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Health Supplements</h3>
              <p className="text-gray-600">
                Vitamins, minerals, collagen, probiotics, and wellness products
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Personal Care</h3>
              <p className="text-gray-600">
                Body lotions, deodorants, dental care, and intimate care products
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Beauty Tools</h3>
              <p className="text-gray-600">
                Facial cleansers, massage devices, hair styling tools, and grooming gadgets
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Organic &amp; Natural Beauty</h3>
              <p className="text-gray-600">
                Clean beauty brands, natural skincare, and cruelty-free products
              </p>
            </div>
          </div>
        </section>

        {/* Best Deals Section */}
        <section className="mb-16 bg-gray-50">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Best Beauty Deals in Singapore</h2>
          <p className="text-lg text-gray-600 mb-8">
            Singapore&apos;s beauty market spans everything from luxury department store counters to affordable drugstore finds. BuyWhere helps you navigate the full spectrum, comparing prices across retailers like Sephora, Watsons, Guardian, Robinsons, and online-first beauty shops. Whether you are stocking up on daily essentials or investing in a premium skincare routine, our comparison tools help you get the most value.
          </p>
          <Link href="/search?q=beauty+health&region=sg" rel="nofollow" className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            Browse Beauty & Health Deals →
          </Link>
        </section>

        {/* Singapore Beauty Retailers */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Singapore Beauty Retailers</h2>
          <p className="text-lg text-gray-600 mb-8">
            BuyWhere features products from all the beauty retailers Singapore shoppers trust, including Sephora, Watsons, Guardian, Robinsons, Isetan, and online platforms like Shopee and Lazada. Compare products across premium, mid-range, and affordable beauty brands.
          </p>
        </section>

        {/* FAQ Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Where can I find authentic beauty products in Singapore?</h3>
              <p className="text-gray-600">
                BuyWhere only indexes authorized retailers and verified sellers. You can shop with confidence knowing that all products listed through our platform come from legitimate sources.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Are beauty products cheaper in duty-free shops in Singapore?</h3>
              <p className="text-gray-600">
                Changi Airport duty-free shops often have exclusive deals on fragrances and skincare. BuyWhere includes duty-free pricing in our comparison when available.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">What are the most popular skincare brands in Singapore?</h3>
              <p className="text-gray-600">
                Top-selling brands include SK-II, Shiseido, La Mer, Drunk Elephant, The Ordinary, Laneige, Sulwhasoo, and many K-beauty and J-beauty favourtes.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Can I compare prices for health supplements in Singapore?</h3>
              <p className="text-gray-600">
                Yes. BuyWhere indexes health supplements from Watsons, Guardian, Unity, and online health stores. Compare prices on vitamins, collagen, probiotics, and wellness products.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Do beauty retailers in Singapore offer free samples?</h3>
              <p className="text-gray-600">
                Many retailers offer free samples with purchase, particularly Sephora and department store counters. Check individual retailer promotions for current offers.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">How do I choose the right skincare products for Singapore&apos;s climate?</h3>
              <p className="text-gray-600">
                Singapore&apos;s humid climate calls for lightweight, non-comedogenic products. Look for oil-free formulas, mineral sunscreen, and hydrating ingredients like hyaluronic acid.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center py-12">
          <p className="text-lg text-gray-600 mb-6">
            Find the best beauty and health products in Singapore with BuyWhere.
          </p>
          <Link href="/search?q=beauty+health&region=sg" rel="nofollow" className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
            Compare Beauty & Health Prices Now →
          </Link>
        </section>
      </div>
    </div>
  );
}
