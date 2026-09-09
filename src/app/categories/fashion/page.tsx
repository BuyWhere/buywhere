import Link from 'next/link';
import { HeroSearch } from '@/components/HeroSearch';
import { buildSgCategoryMetadata } from '@/lib/seo-category-metadata';
import { toSiteUrl } from '@/lib/site-url';

export const metadata = buildSgCategoryMetadata(
  'Fashion Singapore | Compare Prices on Clothing, Shoes & Accessories',
  'Shop fashion online in Singapore. Compare cheapest prices on clothing, shoes, bags, and accessories from Zalora, Amazon SG, Love Bonito, and more. Free shipping deals available.',
  'fashion'
);

const CATEGORY_URL = toSiteUrl('/categories/fashion');

export default function FashionCategoryPage() {
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
            name: "Fashion",
            item: CATEGORY_URL
          }
        ]
      },
      {
        "@type": "CollectionPage",
        "@id": `${CATEGORY_URL}#collection`,
        name: "Fashion Singapore | Compare Prices on Clothing, Shoes & Accessories",
        description: "Shop fashion online in Singapore. Compare cheapest prices on clothing, shoes, bags, and accessories from Zalora, Amazon SG, Love Bonito, and more.",
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
          name: "Fashion Products",
          description: "Clothing, shoes, bags, accessories, and jewellery"
        },
        mainEntity: {
          "@type": "ItemList",
          name: "Fashion Categories",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Women's Clothing" },
            { "@type": "ListItem", position: 2, name: "Men's Fashion" },
            { "@type": "ListItem", position: 3, name: "Shoes" },
            { "@type": "ListItem", position: 4, name: "Bags & Luggage" },
            { "@type": "ListItem", position: 5, name: "Accessories" },
            { "@type": "ListItem", position: 6, name: "Activewear & Sportswear" },
            { "@type": "ListItem", position: 7, name: "Traditional & Ethnic Wear" },
            { "@type": "ListItem", position: 8, name: "Kids' Fashion" }
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
            Fashion Singapore | Compare Prices on Clothing, Shoes & Accessories
          </h1>
          <p className="text-lg text-gray-600 mb-6">
            Singapore&apos;s fashion scene is vibrant and diverse, from local boutique labels to international fast-fashion giants. BuyWhere brings together product listings from hundreds of fashion retailers so you can discover the latest trends without hopping between dozens of websites. Compare prices, check size availability, and find the best deals on everything from everyday essentials to occasion wear.
          </p>
          <HeroSearch />
        </div>

        {/* Why Use BuyWhere Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Why Use BuyWhere for Fashion Shopping?</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  👕
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Massive Fashion Catalog</h3>
              </div>
              <p className="text-gray-600">
                We index clothing, shoes, bags, accessories, and jewellery from over 200 fashion retailers
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  📏
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Size Filtering</h3>
              </div>
              <p className="text-gray-600">
                Filter by size and see real-time stock availability across stores
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🏷️
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Style Categorization</h3>
              </div>
              <p className="text-gray-600">
                Browse by occasion, season, trend, or style preference
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  💰
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Price Comparison</h3>
              </div>
              <p className="text-gray-600">
                Never overpay again. Compare the same item across multiple retailers
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🚚
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Shipping Comparison</h3>
              </div>
              <p className="text-gray-600">
                See estimated delivery times and shipping costs from each retailer
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-lg">
                  🔔
                </span>
                <h3 className="font-semibold text-gray-900 ml-4">Sale Tracking</h3>
              </div>
              <p className="text-gray-600">
                Get alerts when items you love go on sale
              </p>
            </div>
          </div>
        </section>

        {/* Popular Categories */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Popular Fashion Categories in Singapore</h2>
          <p className="text-lg text-gray-600 mb-8">
            Find your next favourite piece:
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Women&apos;s Clothing</h3>
              <p className="text-gray-600">
                Dresses, blouses, skirts, pants, jeans, sarees, and kebaya for every occasion
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Men&apos;s Fashion</h3>
              <p className="text-gray-600">
                Shirts, t-shirts, jeans, trousers, suits, and business casual wear
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Shoes</h3>
              <p className="text-gray-600">
                Sneakers, formal shoes, sandals, heels, boots, and slippers for men and women
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Bags &amp; Luggage</h3>
              <p className="text-gray-600">
                Handbags, backpacks, totes, wallets, and travel luggage
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Accessories</h3>
              <p className="text-gray-600">
                Jewellery, watches, sunglasses, scarves, belts, and hats
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Activewear &amp; Sportswear</h3>
              <p className="text-gray-600">
                Gym wear, running shoes, yoga pants, and outdoor adventure gear
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Traditional &amp; Ethnic Wear</h3>
              <p className="text-gray-600">
                Malay, Indian, and Chinese traditional wear for festivals and occasions
              </p>
            </div>
            <div className="p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <h3 className="font-semibold text-gray-900 mb-2">Kids&apos; Fashion</h3>
              <p className="text-gray-600">
                Children&apos;s clothing, shoes, and accessories for boys and girls
              </p>
            </div>
          </div>
        </section>

        {/* Singapore Fashion Retailers */}
        <section className="mb-16 bg-gray-50">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Singapore Fashion Retailers on BuyWhere</h2>
          <p className="text-lg text-gray-600 mb-8">
            BuyWhere features products from the retailers Singapore shoppers love most, including Zalora, Love Bonito, Charles & Keith, Cotton On, H&M, Uniqlo, Farfetch, Amazon SG, and many independent local boutiques. Whether you are looking for affordable basics or luxury designer pieces, we have got you covered.
          </p>
        </section>

        {/* Fashion for Every Occasion */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Fashion for Every Occasion in Singapore</h2>
          <p className="text-lg text-gray-600 mb-8">
            From office wear to weekend casual, from gym sessions to festive celebrations, Singapore&apos;s fashion landscape caters to every lifestyle. BuyWhere helps you navigate the options, comparing prices across fast fashion brands, mid-range retailers, and luxury boutiques so you can dress your best without breaking the budget.
          </p>
        </section>

        {/* FAQ Section */}
        <section className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Which online fashion stores ship to Singapore?</h3>
              <p className="text-gray-600">
                Most international fashion retailers ship to Singapore, including Amazon SG, Zalora, and Farfetch. BuyWhere shows shipping availability and estimated delivery times for each product.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">How can I find the cheapest fashion deals in Singapore?</h3>
              <p className="text-gray-600">
                BuyWhere compares prices across all major fashion retailers. Our sale alerts and price history features help you identify when items are at their lowest price.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Are designer brands cheaper in Singapore or abroad?</h3>
              <p className="text-gray-600">
                Prices vary significantly. Some luxury items are priced higher in Singapore due to import duties and limited distribution. BuyWhere helps you compare global prices for high-value items.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">What is the best time to shop for fashion in Singapore?</h3>
              <p className="text-gray-600">
                Major sales events like 11.11, 12.12, and end-of-season clearances offer the deepest discounts. BuyWhere tracks price changes so you know the best time to buy.
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="font-semibold text-gray-900 mb-2">Can I return or exchange fashion items bought in Singapore?</h3>
              <p className="text-gray-600">
                Return policies vary by retailer. Most online fashion stores in Singapore offer 14-30 day returns. Check the specific retailer&apos;s policy before purchasing.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center py-12">
          <p className="text-lg text-gray-600 mb-6">
            Discover fashion online in Singapore and build your perfect wardrobe with BuyWhere.
          </p>
          <Link href="/search?q=fashion&region=sg" rel="nofollow" className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
            Shop Fashion Now →
          </Link>
        </section>
      </div>
    </div>
  );
}
