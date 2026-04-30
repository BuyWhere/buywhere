import type { Metadata } from "next";
import Link from "next/link";
import { USSearchAutocomplete } from "@/components/USSearchAutocomplete";
import { USDealsSection } from "@/components/USDealsSection";
import Footer from "@/components/Footer";

interface CategoryPageProps {
  params: Promise<{
    category: string;
  }>;
}

const CATEGORY_META: Record<string, { title: string; description: string; keywords: string[]; subcategories: { name: string; slug: string; description: string }[] }> = {
  electronics: {
    title: "Electronics | Compare Prices from Amazon, Walmart, Target & Best Buy",
    description: "Compare prices on electronics from Amazon, Walmart, Target, and Best Buy. Find the best deals on laptops, TVs, smartphones, headphones, and more.",
    keywords: ["electronics", "laptops", "TVs", "smartphones", "headphones", "Amazon", "Walmart", "Target", "Best Buy", "price comparison"],
    subcategories: [
      { name: "Laptops & Computers", slug: "laptops-computers", description: "MacBooks, gaming laptops, desktops, and PC components" },
      { name: "TVs & Home Entertainment", slug: "tvs-home-entertainment", description: "Smart TVs, soundbars, streaming devices, and home theatre" },
      { name: "Headphones & Audio", slug: "headphones-audio", description: "Wireless earbuds, headphones, portable speakers, and hi-fi systems" },
      { name: "Gaming", slug: "gaming", description: "PlayStation 5, Xbox, Nintendo Switch, gaming headsets, and accessories" },
      { name: "Cameras & Photography", slug: "cameras-photography", description: "DSLRs, mirrorless cameras, action cameras, and lenses" },
      { name: "Smart Home", slug: "smart-home", description: "Amazon Echo, Google Nest, smart bulbs, security cameras, and robot vacuums" },
    ],
  },
  fashion: {
    title: "Fashion | Compare Prices from Amazon, Walmart, Target & More",
    description: "Compare prices on fashion items from Amazon, Walmart, Target, and more. Find the best deals on clothing, shoes, accessories, and more.",
    keywords: ["fashion", "clothing", "shoes", "accessories", "Amazon", "Walmart", "Target", "price comparison"],
    subcategories: [
      { name: "Men's Clothing", slug: "mens-clothing", description: "T-shirts, jeans, jackets, and formal wear" },
      { name: "Women's Clothing", slug: "womens-clothing", description: "Dresses, tops, pants, and outerwear" },
      { name: "Shoes & Footwear", slug: "shoes-footwear", description: "Sneakers, boots, sandals, and formal shoes" },
      { name: "Accessories", slug: "accessories", description: "Bags, watches, jewelry, and sunglasses" },
    ],
  },
  "home-living": {
    title: "Home & Living | Compare Prices from Amazon, Walmart, Target & More",
    description: "Compare prices on home and kitchen products from Amazon, Walmart, Target, and more. Find the best deals on furniture, appliances, cookware, and more.",
    keywords: ["home-living", "home", "kitchen", "furniture", "appliances", "cookware", "Amazon", "Walmart", "Target", "price comparison"],
    subcategories: [
      { name: "Furniture", slug: "furniture", description: "Sofas, beds, tables, and storage solutions" },
      { name: "Kitchen Appliances", slug: "kitchen-appliances", description: "Blenders, coffee makers, air fryers, and more" },
      { name: "Cookware", slug: "cookware", description: "Pots, pans, knife sets, and cooking tools" },
      { name: "Home Decor", slug: "home-decor", description: "Rugs, curtains, pillows, and wall art" },
    ],
  },
  beauty: {
    title: "Beauty | Compare Prices from Amazon, Walmart, Target & More",
    description: "Compare prices on beauty and personal care products from Amazon, Walmart, Target, and more. Find the best deals on skincare, makeup, haircare, and more.",
    keywords: ["beauty", "skincare", "makeup", "haircare", "Amazon", "Walmart", "Target", "price comparison"],
    subcategories: [
      { name: "Skincare", slug: "skincare", description: "Moisturizers, serums, cleansers, and SPF" },
      { name: "Makeup", slug: "makeup", description: "Foundation, lipstick, eyeshadow, and mascara" },
      { name: "Haircare", slug: "haircare", description: "Shampoo, conditioner, styling products, and tools" },
      { name: "Fragrances", slug: "fragrances", description: "Perfumes, colognes, and body sprays" },
    ],
  },
};

const DEFAULT_CATEGORY = {
  title: "Category | Compare Prices from Amazon, Walmart, Target & More",
  description: "Compare prices from Amazon, Walmart, Target, and Best Buy. Find the best deals on products you love.",
  keywords: ["price comparison", "Amazon", "Walmart", "Target", "Best Buy", "deals"],
  subcategories: [],
};

function formatCategoryName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function CategoryHero({ category }: { category: string }) {
  const categoryName = formatCategoryName(category);

  return (
    <section className="bg-gradient-to-b from-indigo-50 to-white py-16 md:py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center max-w-3xl mx-auto">
          <nav className="text-sm text-gray-500 mb-4" aria-label="Breadcrumb">
            <ol className="flex items-center justify-center gap-2">
              <li><Link href="/us" className="hover:text-indigo-600">BuyWhere US</Link></li>
              <li aria-hidden="true">/</li>
              <li className="text-gray-900 font-medium" aria-current="page">{categoryName}</li>
            </ol>
          </nav>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Compare {categoryName} Prices
          </h1>
          <p className="text-lg text-gray-600 mb-8">
            Find the best deals on {categoryName.toLowerCase()} across Amazon, Walmart, Target, and Best Buy.
          </p>
          <div className="max-w-xl mx-auto">
            <div className="relative">
              <USSearchAutocomplete
                value=""
                onChange={() => {}}
                onSubmit={(query) => {
                  window.location.href = `/search?q=${encodeURIComponent(query)}&region=us&category=${category}`;
                }}
                placeholder={`Search ${categoryName.toLowerCase()} products...`}
              />
            </div>
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-full">
              ✓ Amazon
            </span>
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-full">
              ✓ Walmart
            </span>
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-full">
              ✓ Target
            </span>
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-full">
              ✓ Best Buy
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustBadges() {
  return (
    <section className="py-12 bg-white border-y border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          <div>
            <div className="text-2xl font-bold text-gray-900">50M+</div>
            <div className="text-sm text-gray-500">Products indexed</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">4</div>
            <div className="text-sm text-gray-500">Major retailers</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">Free</div>
            <div className="text-sm text-gray-500">To use</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">Daily</div>
            <div className="text-sm text-gray-500">Price updates</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SubcategoriesSection({ subcategories }: { subcategories: { name: string; slug: string; description: string }[] }) {
  if (subcategories.length === 0) return null;

  return (
    <section className="py-16 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-8 text-center">
          Browse {formatCategoryName("subcategories")}
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {subcategories.map((sub) => (
            <Link
              key={sub.slug}
              href={`/us/${sub.slug}`}
              className="group p-6 bg-white rounded-xl border border-gray-100 hover:shadow-md hover:border-indigo-100 transition-all duration-200"
            >
              <h3 className="font-semibold text-gray-900 mb-2 group-hover:text-indigo-600 transition-colors">
                {sub.name}
              </h3>
              <p className="text-sm text-gray-600">{sub.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhyCompareSection({ category }: { category: string }) {
  const categoryName = formatCategoryName(category);

  const benefits = [
    {
      icon: "🔄",
      title: "Real-time Price Comparison",
      description: `Compare prices on ${categoryName.toLowerCase()} from Amazon, Walmart, Target, and Best Buy in real-time.`,
    },
    {
      icon: "📊",
      title: "Price History Tracking",
      description: "Track price changes over time and see when prices are at their lowest.",
    },
    {
      icon: "✅",
      title: "Verified Merchant Data",
      description: "All retailer prices are verified and updated daily for accuracy.",
    },
    {
      icon: "🚚",
      title: "Stock Availability",
      description: "See which products are in stock at each retailer before you visit.",
    },
  ];

  return (
    <section className="py-16 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-8 text-center">
          Why Compare {categoryName} Prices on BuyWhere?
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {benefits.map((benefit) => (
            <div key={benefit.title} className="text-center p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
              <div className="text-4xl mb-4">{benefit.icon}</div>
              <h3 className="font-semibold text-gray-900 mb-2">{benefit.title}</h3>
              <p className="text-sm text-gray-600">{benefit.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection({ category }: { category: string }) {
  return (
    <section className="py-16 bg-indigo-600">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">
          Ready to find the best deal?
        </h2>
        <p className="text-indigo-100 mb-8 max-w-xl mx-auto">
          Start comparing {formatCategoryName(category).toLowerCase()} prices now and save money on every purchase.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            href="/compare/us"
            className="inline-flex items-center justify-center px-6 py-3 bg-white text-indigo-600 font-semibold rounded-lg hover:bg-indigo-50 transition-colors"
          >
            Browse all deals
          </Link>
          <Link
            href="/us"
            className="inline-flex items-center justify-center px-6 py-3 border-2 border-white text-white font-semibold rounded-lg hover:bg-indigo-500 transition-colors"
          >
            Back to US home
          </Link>
        </div>
      </div>
    </section>
  );
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
   const { category } = await params;
   const categoryData = CATEGORY_META[category] || DEFAULT_CATEGORY;

   return {
     title: categoryData.title,
     description: categoryData.description,
     keywords: categoryData.keywords,
     openGraph: {
       title: categoryData.title,
       description: categoryData.description,
       type: "website",
       locale: "en_US",
       siteName: "BuyWhere US",
       images: [
         {
           url: "https://buywhere.ai/assets/img/og-image.png",
           width: 1200,
           height: 630,
           alt: `${categoryData.title} - BuyWhere US`,
         },
         {
           url: "https://buywhere.ai/assets/img/og-image.svg",
           width: 1200,
           height: 630,
           alt: `${categoryData.title} - BuyWhere US`,
         },
       ],
     },
     twitter: {
       card: "summary_large_image",
       title: categoryData.title,
       description: categoryData.description,
     },
     alternates: {
       canonical: `https://buywhere.ai/us/${category}`,
     },
   };
 }

export default async function USCategoryPage({ params }: CategoryPageProps) {
  const { category } = await params;
  const categoryData = CATEGORY_META[category] || DEFAULT_CATEGORY;
  const categoryName = formatCategoryName(category);

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "BuyWhere US",
        item: "https://buywhere.ai/us",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: categoryName,
        item: `https://buywhere.ai/us/${category}`,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <div className="flex flex-col min-h-screen">
        <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <Link href="/us" className="flex items-center gap-2 font-bold text-lg text-indigo-600">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="28" height="28" rx="6" fill="#4f46e5" />
              <path d="M7 10h14M7 14h10M7 18h12" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
            BuyWhere US
          </Link>
          <div className="flex items-center gap-4 text-sm font-medium text-gray-600">
            <Link href="/compare/us" className="hover:text-indigo-600 transition-colors">
              Browse Products
            </Link>
            <Link href="/retailers" className="hover:text-indigo-600 transition-colors">
              Retailers
            </Link>
            <Link
              href="/api-keys"
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Get API Key
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <CategoryHero category={category} />
        <TrustBadges />
        <SubcategoriesSection subcategories={categoryData.subcategories} />
        <WhyCompareSection category={category} />
        <USDealsSection />
        <CTASection category={category} />
      </main>

      <Footer />
    </div>
    </>
  );
}