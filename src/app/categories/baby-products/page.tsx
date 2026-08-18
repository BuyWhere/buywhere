import Link from 'next/link';
import { HeroSearch } from '@/components/HeroSearch';
import { buildSgCategoryMetadata } from '@/lib/seo-category-metadata';
import { toSiteUrl } from '@/lib/site-url';

export const metadata = buildSgCategoryMetadata(
  'Baby Products Singapore | Compare Best Prices on Diapers, Strollers & Nursery Gear',
  'Find the best baby products in Singapore. Compare prices on diapers, formula, strollers, cots, nursery gear, and baby care essentials from top retailers.',
  'baby-products'
);

const CATEGORY_URL = toSiteUrl('/categories/baby-products');

export default function BabyProductsCategoryPage() {
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
            name: "Baby Products",
            item: CATEGORY_URL
          }
        ]
      },
      {
        "@type": "CollectionPage",
        "@id": `${CATEGORY_URL}#collection`,
        name: "Baby Products Singapore | Compare Best Prices on Diapers, Strollers & Nursery Gear",
        description: "Find the best baby products in Singapore. Compare prices on diapers, formula, strollers, cots, nursery gear, and baby care essentials from top retailers.",
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
          name: "Baby Products",
          description: "Diapers, baby formula, strollers, cots, nursery furniture, baby monitors, car seats, and baby care essentials"
        },
        mainEntity: {
          "@type": "ItemList",
          name: "Baby Products Categories",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Diapers & Wipes" },
            { "@type": "ListItem", position: 2, name: "Baby Formula & Food" },
            { "@type": "ListItem", position: 3, name: "Strollers & Car Seats" },
            { "@type": "ListItem", position: 4, name: "Nursery & Feeding" },
            { "@type": "ListItem", position: 5, name: "Baby Clothing" },
            { "@type": "ListItem", position: 6, name: "Baby Toys & Development" },
            { "@type": "ListItem", position: 7, name: "Baby Bath & Care" },
            { "@type": "ListItem", position: 8, name: "Travel Essentials" }
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
            Baby Products Singapore | Compare Best Prices on Diapers, Strollers & Nursery Gear
          </h1>
          <p className="text-lg text-gray-600 mb-6">
            Shopping for baby products in Singapore? BuyWhere helps parents compare prices on everyday essentials and bigger-ticket nursery gear across trusted retailers. Find diapers, feeding supplies, strollers, car seats, and baby care products without jumping between stores.
          </p>
          <HeroSearch />
        </div>

        {/* Why Compare Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Why Compare Baby Product Prices on BuyWhere?</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🔄
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Real-time Price Comparison</h3>
              </div>
              <p className="text-gray-600">
                Compare prices from supermarkets, pharmacies, department stores, and online-only stores across Singapore
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
                From everyday diapers and formula to strollers and nursery gear, we index products across all price segments
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
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Featured Baby Products Categories</h2>
          <p className="text-lg text-gray-600 mb-8">
            Browse our most popular baby product categories in Singapore:
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Diapers & Wipes</h3>
              <p className="text-gray-600">
                Pampers, Huggies, Drypers, and sensitive baby wipes
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Baby Formula & Food</h3>
              <p className="text-gray-600">
                Milk formula, baby cereals, food pouches, and snacks
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Strollers & Car Seats</h3>
              <p className="text-gray-600">
                Buggies, travel systems, infant seats, and boosters
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Nursery & Feeding</h3>
              <p className="text-gray-600">
                Cots, high chairs, baby monitors, bottles, and breast pumps
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Baby Clothing</h3>
              <p className="text-gray-600">
                Onesies, sleepsuits, swaddles, mittens, and hats
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Baby Toys & Development</h3>
              <p className="text-gray-600">
                Rattles, playmats, activity centres, and early learning toys
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Baby Bath & Care</h3>
              <p className="text-gray-600">
                Baby wash, shampoo, lotion, creams, and grooming kits
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Travel Essentials</h3>
              <p className="text-gray-600">
                Diaper bags, carriers, portable cots, and travel accessories
              </p>
            </div>
          </div>
        </section>

        {/* Best Deals Section */}
        <section className="mb-16 bg-gray-50">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Best Baby Product Deals in Singapore</h2>
          <p className="text-lg text-gray-600 mb-8">
            Baby essentials are repeat purchases, and prices vary widely between supermarkets, pharmacies, department stores, and online marketplaces. BuyWhere helps you compare options before you stock up.
          </p>
          <p className="text-lg text-gray-600 mb-6">
            Whether you are a first-time parent preparing for a newborn or an experienced caregiver stocking up on essentials, BuyWhere helps you make informed purchasing decisions.
          </p>
          <Link href="/search?q=baby-products&region=sg" className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            Browse Baby Product Deals →
          </Link>
        </section>

        {/* FAQ Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Where can I find the best baby products deals in Singapore?</h3>
              <p className="text-gray-600">
                BuyWhere aggregates prices from major retailers in Singapore. Our comparison tool shows prices across department stores, specialty shops, and online platforms so you can find better value.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Are baby product prices in Singapore inclusive of GST?</h3>
              <p className="text-gray-600">
                All prices on BuyWhere show both ex-GST and inclusive prices. Singapore&apos;s 9% GST is applied at checkout, and we help you see the true cost before purchase.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Which retailer has the best baby product prices in Singapore?</h3>
              <p className="text-gray-600">
                Prices vary by product and retailer. Our data shows that online marketplaces and bulk-buy deals often beat single-store pricing on consumables, while department store bundles can offer better value on nursery gear.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Can I compare prices for second-hand baby products?</h3>
              <p className="text-gray-600">
                Currently, BuyWhere focuses on new products from authorized retailers. We are working on adding certified refurbished listings from approved sellers.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">How often are baby product prices updated on BuyWhere?</h3>
              <p className="text-gray-600">
                Update cadence can vary by source and product. Check the current product detail and docs surfaces for the latest publicly documented availability and freshness guidance before making time-sensitive purchasing decisions.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Do baby product retailers deliver to all of Singapore?</h3>
              <p className="text-gray-600">
                BuyWhere shows product availability by retailer. Delivery options vary by retailer — most offer island-wide delivery within 1-3 business days.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center py-12">
          <p className="text-lg text-gray-600 mb-6">
            Start comparing baby products prices in Singapore today and find the best deals across major retailers.
          </p>
          <Link href="/search?q=baby-products&region=sg" className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
            Compare Baby Product Prices Now →
          </Link>
        </section>
      </div>
    </main>
  );
}
