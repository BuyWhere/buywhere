import Link from 'next/link';
import { HeroSearch } from '@/components/HeroSearch';
import { buildSgCategoryMetadata } from '@/lib/seo-category-metadata';
import { toSiteUrl } from '@/lib/site-url';

export const metadata = buildSgCategoryMetadata(
  'Books & Stationery Singapore | Compare Prices on Books, Notebooks & Office Supplies',
  'Compare book and stationery prices in Singapore. Find deals on novels, textbooks, notebooks, pens, office supplies, and school essentials from top retailers.',
  'books-stationery'
);

const CATEGORY_URL = toSiteUrl('/categories/books-stationery');

export default function BooksStationeryCategoryPage() {
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
            name: "Books & Stationery",
            item: CATEGORY_URL
          }
        ]
      },
      {
        "@type": "CollectionPage",
        "@id": `${CATEGORY_URL}#collection`,
        name: "Books & Stationery Singapore | Compare Prices on Books, Notebooks & Office Supplies",
        description: "Compare book and stationery prices in Singapore. Find deals on novels, textbooks, notebooks, pens, office supplies, and school essentials from top retailers.",
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
          name: "Books & Stationery",
          description: "Novels, textbooks, children books, e-books, notebooks, pens, office supplies, and school essentials"
        },
        mainEntity: {
          "@type": "ItemList",
          name: "Books & Stationery Categories",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Fiction & Novels" },
            { "@type": "ListItem", position: 2, name: "Non-Fiction & Self-Help" },
            { "@type": "ListItem", position: 3, name: "Children Books" },
            { "@type": "ListItem", position: 4, name: "Academic Textbooks" },
            { "@type": "ListItem", position: 5, name: "Notebooks & Binders" },
            { "@type": "ListItem", position: 6, name: "Pens & Writing" },
            { "@type": "ListItem", position: 7, name: "Office Supplies" },
            { "@type": "ListItem", position: 8, name: "Art & Craft" }
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
            Books & Stationery Singapore | Compare Prices on Books, Notebooks & Office Supplies
          </h1>
          <p className="text-lg text-gray-600 mb-6">
            Looking for books and stationery in Singapore? BuyWhere compares prices across bookstores, office supply shops, school suppliers, and online marketplaces so you can find better deals on reading materials and everyday writing essentials.
          </p>
          <HeroSearch />
        </div>

        {/* Why Compare Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Why Compare Books & Stationery Prices on BuyWhere?</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🔄
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Real-time Price Comparison</h3>
              </div>
              <p className="text-gray-600">
                Compare prices from bookstores, office supply shops, school suppliers, and online-only stores across Singapore
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
                From textbooks and bestsellers to everyday stationery and art supplies, we index products across all price segments
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
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Featured Books & Stationery Categories</h2>
          <p className="text-lg text-gray-600 mb-8">
            Browse our most popular books and stationery categories in Singapore:
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Fiction & Novels</h3>
              <p className="text-gray-600">
                Bestsellers, literary fiction, mystery, romance, sci-fi, and fantasy
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Non-Fiction & Self-Help</h3>
              <p className="text-gray-600">
                Business, biography, health, personal development, and more
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Children Books</h3>
              <p className="text-gray-600">
                Picture books, chapter books, educational books, and activity books
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Academic Textbooks</h3>
              <p className="text-gray-600">
                University, polytechnic, secondary, and primary school textbooks
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Notebooks & Binders</h3>
              <p className="text-gray-600">
                Exercise books, refill paper, ring binders, and organizers
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Pens & Writing</h3>
              <p className="text-gray-600">
                Ballpoint pens, gel pens, highlighters, pencils, and markers
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Office Supplies</h3>
              <p className="text-gray-600">
                Paper, folders, labels, staplers, calculators, and desk tools
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Art & Craft</h3>
              <p className="text-gray-600">
                Sketchbooks, paints, brushes, craft kits, and supplies
              </p>
            </div>
          </div>
        </section>

        {/* Best Deals Section */}
        <section className="mb-16 bg-gray-50">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Best Books & Stationery Deals in Singapore</h2>
          <p className="text-lg text-gray-600 mb-8">
            From school-term stock-ups to office replenishment and new releases, books and stationery prices shift across retailers. BuyWhere helps shoppers compare before buying.
          </p>
          <p className="text-lg text-gray-600 mb-6">
            Whether you are a student getting ready for the school term or a professional kitting out a workspace, BuyWhere helps you make informed purchasing decisions.
          </p>
          <Link href="/search?q=books-stationery&region=sg" className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            Browse Books & Stationery Deals →
          </Link>
        </section>

        {/* FAQ Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Where can I find the best books & stationery deals in Singapore?</h3>
              <p className="text-gray-600">
                BuyWhere aggregates prices from major retailers in Singapore. Our comparison tool shows prices across department stores, specialty shops, and online platforms so you can find better value.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Are book and stationery prices in Singapore inclusive of GST?</h3>
              <p className="text-gray-600">
                All prices on BuyWhere show both ex-GST and inclusive prices. Singapore&apos;s 9% GST is applied at checkout, and we help you see the true cost before purchase.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Which retailer has the best book and stationery prices in Singapore?</h3>
              <p className="text-gray-600">
                Prices vary by product and retailer. Our data shows that online bookstores often beat physical chains on new releases, while school suppliers and stationery shops offer better value on bulk stationery.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Can I compare prices for second-hand books?</h3>
              <p className="text-gray-600">
                Currently, BuyWhere focuses on new products from authorized retailers. We are working on adding certified refurbished listings from approved sellers.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">How often are book and stationery prices updated on BuyWhere?</h3>
              <p className="text-gray-600">
                Update cadence can vary by source and product. Check the current product detail and docs surfaces for the latest publicly documented availability and freshness guidance before making time-sensitive purchasing decisions.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Do book and stationery retailers deliver to all of Singapore?</h3>
              <p className="text-gray-600">
                BuyWhere shows product availability by retailer. Delivery options vary by retailer — most offer island-wide delivery within 1-3 business days.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center py-12">
          <p className="text-lg text-gray-600 mb-6">
            Start comparing books & stationery prices in Singapore today and find the best deals across major retailers.
          </p>
          <Link href="/search?q=books-stationery&region=sg" className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
            Compare Books & Stationery Prices Now →
          </Link>
        </section>
      </div>
    </main>
  );
}
