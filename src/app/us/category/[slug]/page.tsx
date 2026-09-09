import type { Metadata } from "next";
import Link from "next/link";
import { CategoryBrowseClient, CategoryPageConfig } from "@/components/category";
import { US_CATEGORY_META } from "@/lib/taxonomy";
import { toSiteUrl } from "@/lib/site-url";


function generateFacets() {
  return {
    brands: [
      { value: "Apple", count: 234 },
      { value: "Samsung", count: 189 },
      { value: "Sony", count: 156 },
      { value: "LG", count: 123 },
      { value: "Dell", count: 98 },
      { value: "HP", count: 87 },
      { value: "Nike", count: 156 },
      { value: "Adidas", count: 134 },
    ],
    priceRanges: [
      { range: "Under $25", min: 0, max: 25, count: 234 },
      { range: "$25 - $50", min: 25, max: 50, count: 456 },
      { range: "$50 - $100", min: 50, max: 100, count: 789 },
      { range: "$100 - $200", min: 100, max: 200, count: 567 },
      { range: "Over $200", min: 200, max: 9999, count: 234 },
    ],
    colors: [
      { value: "Black", hex: "#1a1a2e", count: 345 },
      { value: "White", hex: "#ffffff", count: 234 },
      { value: "Navy", hex: "#1e3a5f", count: 189 },
      { value: "Red", hex: "#dc3545", count: 156 },
      { value: "Beige", hex: "#e9c46a", count: 123 },
      { value: "Green", hex: "#2a9d8f", count: 98 },
    ],
    sizes: [
      { code: "XS", count: 45, available: true },
      { code: "S", count: 123, available: true },
      { code: "M", count: 234, available: true },
      { code: "L", count: 189, available: true },
      { code: "XL", count: 98, available: true },
      { code: "XXL", count: 34, available: false },
    ],
    availability: [
      { value: "In Stock", count: 1234 },
      { value: "Out of Stock", count: 56 },
    ],
    regions: [
      { value: "United States", count: 890 },
      { value: "Singapore", count: 234 },
      { value: "Malaysia", count: 123 },
      { value: "Indonesia", count: 89 },
      { value: "Thailand", count: 67 },
    ],
  };
}

function getCategoryConfig(slug: string): CategoryPageConfig | null {
  const meta = US_CATEGORY_META[slug];
  if (!meta) return null;

  return {
    categoryName: meta.name,
    breadcrumbs: meta.breadcrumbs,
    subcategories: [
      { id: "all", name: "All" },
      { id: "smartphones", name: "Mobile Phones & Tablets", productCount: 234 },
      { id: "laptops", name: "Laptops & Computers", productCount: 189 },
      { id: "tvs", name: "TVs & Home Entertainment", productCount: 156 },
      { id: "gaming", name: "Gaming", productCount: 123 },
      { id: "audio", name: "Audio", productCount: 98 },
      { id: "wearables", name: "Wearables", productCount: 67 },
    ],
    products: [],
    facets: generateFacets(),
    totalProducts: 0,
  };
}

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const meta = US_CATEGORY_META[params.slug];
  if (!meta) {
    return {
      title: "Category Not Found",
      description: "The requested category could not be found.",
    };
  }

  return {
    title: `${meta.name} — Compare Prices | BuyWhere US`,
    description: meta.description,
    alternates: {
      canonical: toSiteUrl(`/us/category/${meta.slug}/`),
    },
    openGraph: {
      title: `${meta.name} — BuyWhere US`,
      description: meta.description,
      url: `https://buywhere.ai/us/category/${meta.slug}/`,
      type: "website",
      locale: "en_US",
      siteName: "BuyWhere US",
    },
    twitter: {
      card: "summary_large_image",
      title: `${meta.name} — Compare Prices | BuyWhere US`,
      description: meta.description,
    },
  };
}

export default function USCategoryBrowsePage({ params }: PageProps) {
  const config = getCategoryConfig(params.slug);

  if (!config) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Category Not Found</h1>
          <p className="text-gray-600 mb-6">
            We don&apos;t have a page for this category yet.
          </p>
          <Link
            href="/us"
            className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Back to BuyWhere US
          </Link>
        </div>
      </div>
    );
  }

  const baseUrl = "https://buywhere.ai";
  const categoryUrl = `${baseUrl}/us/category/${params.slug}`;

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": "https://buywhere.ai/#breadcrumb",
    itemListElement: config.breadcrumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.href ? `${baseUrl}${crumb.href}` : undefined,
    })),
  };

  const productListSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${categoryUrl}#item-list`,
    name: `All ${config.categoryName} Products`,
    numberOfItems: config.products.length,
    url: categoryUrl,
    mainEntityOfPage: categoryUrl,
    itemListElement: config.products.slice(0, 20).map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: product.url,
      item: {
        "@type": "Product",
        name: product.name,
        brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
        image: product.imageUrl,
        offers: {
          "@type": "Offer",
          price: product.price.toFixed(2),
          priceCurrency: "USD",
          availability: product.inStock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          seller: { "@type": "Organization", "@id": "https://buywhere.ai/#organization", name: "BuyWhere" },
        },
      },
    })),
  };

  const collectionPageSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${categoryUrl}#collection`,
    name: `${config.categoryName} — Compare Prices | BuyWhere US`,
    description: config.breadcrumbs[0]?.name
      ? `Browse and compare ${config.categoryName} products from multiple retailers. Find the best deals on electronics, fashion, home goods, and more.`
      : `Compare prices on ${config.categoryName} from top retailers.`,
    url: categoryUrl,
    mainEntityOfPage: categoryUrl,
    mainEntity: productListSchema,
    publisher: { "@type": "Organization", "@id": "https://buywhere.ai/#organization", name: "BuyWhere" },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionPageSchema) }}
      />
      <CategoryBrowseClient config={config} />
    </>
  );
}
