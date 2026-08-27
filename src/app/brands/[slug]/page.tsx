import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Emergency fix 2026-08-26: the root layout now reads request headers(), which makes an
export const revalidate = 900;

interface BrandProduct {
  slug: string;
  name: string;
  price: number;
  rating: number;
  in_stock: boolean;
  image_url?: string;
  compare_url: string;
}

interface BrandData {
  slug: string;
  name: string;
  logo_url?: string;
  description: string;
  product_count: number;
  products: BrandProduct[];
}

async function getBrandData(slug: string): Promise<BrandData> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/v1/brand/${slug}`, {
    next: { revalidate: 900 },
  });
  if (res.status === 404) {
    // Definitive does-not-exist → caller should notFound()
    return null as unknown as BrandData;
  }
  if (!res.ok) {
    // Transient backend failure (5xx, 429, etc.) → caller should 503
    throw Object.assign(new Error(`Brand API returned ${res.status}`), { status: res.status });
  }
  return res.json();
}

function buildTransientErrorResponse(slug: string): Response {
  const message = `Brand "${slug}" is temporarily unavailable. The catalog backend returned an error. Please try again in a few minutes.`;
  return new Response(message, {
    status: 503,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Retry-After': '120',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}

function buildJsonLd(data: BrandData) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${data.name} Products — BuyWhere`,
    description: data.description,
    url: `/brands/${data.slug}`,
    mainEntity: {
      '@type': 'ItemList',
      name: `${data.name} Products`,
      numberOfItems: data.product_count,
      itemListElement: data.products.map((product, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Product',
          name: product.name,
          offers: {
            '@type': 'Offer',
            price: product.price,
            priceCurrency: 'USD',
            availability: product.in_stock
              ? 'https://schema.org/InStock'
              : 'https://schema.org/OutOfStock',
          },
        },
      })),
    },
  };
}

export default async function BrandsBrandPage({ params }: PageProps) {
  const { slug } = await params;
  let brand: BrandData;
  try {
    brand = await getBrandData(slug);
  } catch (err: unknown) {
    // Transient backend failure (5xx, timeout, network) → 503 with Retry-After.
    // NEVER 404 on transient errors: a 404 tells Google to drop the URL.
    if (err && typeof err === 'object' && 'status' in err) {
      return buildTransientErrorResponse(slug);
    }
    // Unknown error type → also treat as transient
    return buildTransientErrorResponse(slug);
  }

  if (!brand) {
    // Definitive does-not-exist: API returned 404 for this slug
    notFound();
  }

  const jsonLd = buildJsonLd(brand);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
        <div className="container mx-auto px-4 py-16">
          <nav className="mb-6 text-sm text-gray-500">
            <Link href="/brands" className="text-blue-600 hover:underline">
              Brands
            </Link>
            <span className="mx-2">/</span>
            <span>{brand.name}</span>
          </nav>

          <header className="mb-12">
            <div className="flex items-center gap-4 mb-4">
              {brand.logo_url && (
                <img
                  src={brand.logo_url}
                  alt={brand.name}
                  className="h-14 w-14 object-contain"
                />
              )}
              <h1 className="text-4xl font-bold text-blue-800">
                {brand.name}
              </h1>
            </div>
            {brand.description && (
              <p className="text-lg text-gray-600">{brand.description}</p>
            )}
            <p className="text-sm text-gray-500 mt-2">
              {brand.product_count} products — compare prices across retailers
            </p>
          </header>

          {brand.products.length > 0 ? (
            <section>
              <h2 className="text-2xl font-semibold text-gray-800 mb-6">
                {brand.name} Products
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {brand.products.map((product) => (
                  <article
                    key={product.slug}
                    className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
                  >
                    {product.image_url && (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="h-40 w-full object-contain mb-4 rounded"
                      />
                    )}
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      {product.name}
                    </h3>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-yellow-500 font-medium">
                        ★ {product.rating.toFixed(1)}
                      </span>
                      <span
                        className={`text-sm ${
                          product.in_stock ? 'text-green-600' : 'text-red-500'
                        }`}
                      >
                        {product.in_stock ? 'In Stock' : 'Out of Stock'}
                      </span>
                    </div>
                    <p className="text-xl font-bold text-gray-900 mb-4">
                      ${product.price.toFixed(2)}
                    </p>
                    <a
                      href={product.compare_url}
                      className="block text-center bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                      Compare Prices
                    </a>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <section className="text-center py-12">
              <p className="text-gray-500 text-lg">
                No products found for {brand.name} yet.
              </p>
              <Link
                href="/brands"
                className="text-blue-600 hover:underline mt-4 inline-block"
              >
                Browse other brands
              </Link>
            </section>
          )}
        </div>
      </main>
    </>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  let brand: BrandData | null = null;
  try {
    brand = await getBrandData(slug);
  } catch {
    // Transient error during metadata generation → use generic title
    // (page component will serve 503; metadata is best-effort)
  }

  if (!brand) {
    return { title: 'Brand Not Found' };
  }

  return {
    title: `${brand.name} Products — Compare Prices | BuyWhere`,
    description: brand.description,
    alternates: { canonical: `/brands/${slug}` },
  };
}

export async function generateStaticParams() {
  return [];
}
