import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const revalidate = 900;

interface BrandData {
  slug: string;
  name: string;
  logo_url?: string;
  description: string;
  product_count: number;
}

async function getBrandData(slug: string): Promise<BrandData | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/v1/brand/${slug}`, {
      next: { revalidate: 900 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      slug: data.slug,
      name: data.name,
      logo_url: data.logo_url,
      description: data.description || '',
      product_count: data.product_count || 0,
    };
  } catch {
    return null;
  }
}

export default async function BrandsBrandDealsEarnPage({ params }: PageProps) {
  const { slug } = await params;
  const brand = await getBrandData(slug);

  if (!brand) {
    notFound();
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${brand.name} Cashback — BuyWhere`,
    description: `Earn cashback on ${brand.name} purchases. Shop through BuyWhere and get rewards back.`,
    url: `/brands/brand/${slug}/deals/earn`,
  };

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
            <Link
              href={`/brands/brand/${slug}`}
              className="text-blue-600 hover:underline"
            >
              {brand.name}
            </Link>
            <span className="mx-2">/</span>
            <Link
              href={`/brands/brand/${slug}/deals`}
              className="text-blue-600 hover:underline"
            >
              Deals
            </Link>
            <span className="mx-2">/</span>
            <span>Earn</span>
          </nav>

          <header className="mb-12">
            <h1 className="text-4xl font-bold text-blue-800 mb-4">
              Earn Cashback on {brand.name}
            </h1>
            <p className="text-lg text-gray-600">
              Shop through BuyWhere and earn rewards on every {brand.name} purchase.
            </p>
          </header>

          <section className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <div className="text-4xl mb-4">🔍</div>
              <h2 className="text-xl font-semibold text-gray-800 mb-2">
                Compare Prices
              </h2>
              <p className="text-gray-600">
                Search for {brand.name} products and compare prices across hundreds of retailers instantly.
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <div className="text-4xl mb-4">🛒</div>
              <h2 className="text-xl font-semibold text-gray-800 mb-2">
                Shop Through Us
              </h2>
              <p className="text-gray-600">
                Click through to your chosen retailer and complete your purchase as normal.
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-8 text-center">
              <div className="text-4xl mb-4">💰</div>
              <h2 className="text-xl font-semibold text-gray-800 mb-2">
                Earn Rewards
              </h2>
              <p className="text-gray-600">
                Get cashback on every purchase. The more you shop, the more you earn.
              </p>
            </div>
          </section>

          <section className="text-center">
            <Link
              href={`/brands/brand/${slug}`}
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Browse {brand.name} Products
            </Link>
          </section>
        </div>
      </main>
    </>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrandData(slug);

  if (!brand) {
    return { title: 'Brand Cashback Not Found' };
  }

  return {
    title: `Earn Cashback on ${brand.name} — BuyWhere`,
    description: `Earn cashback on ${brand.name} purchases. Shop through BuyWhere and get rewards back.`,
    alternates: { canonical: `/brands/brand/${slug}/deals/earn` },
  };
}

export async function generateStaticParams() {
  return [];
}
