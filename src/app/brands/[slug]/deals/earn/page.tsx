import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import { apiBase, apiHeaders } from "@/lib/server-api";
import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandCatalogError } from '@/components/brands/BrandCatalogError';
import { brandCatalogErrorMetadata } from '@/lib/brand-catalog-error';

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

async function getBrandData(slug: string): Promise<BrandData> {
  const res = await fetch(`${apiBase()}/v1/brand/${slug}`, { headers: apiHeaders(),
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
  const data = await res.json();
  return {
    slug: data.slug,
    name: data.name,
    logo_url: data.logo_url,
    description: data.description || '',
    product_count: data.product_count || 0,
  };
}

// BUY-78751: shared catalog-error UI (never "Brand Not Found").

export default async function BrandsBrandDealsEarnPage({ params }: PageProps) {
  const { slug } = await params;
  let brand: BrandData;
  try {
    brand = await getBrandData(slug);
  } catch {
    // Transient backend failure (5xx, timeout, network) → error page.
    // NEVER 404 on transient errors: a 404 tells Google to drop the URL.
    noStore();
    return <BrandCatalogError slug={slug} />;
  }

  if (!brand) {
    // Definitive does-not-exist: API returned 404 for this slug
    notFound();
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${brand.name} Cashback — BuyWhere`,
    description: `Earn cashback on ${brand.name} purchases. Shop through BuyWhere and get rewards back.`,
    url: `/brands/${slug}/deals/earn`,
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
              href={`/brands/${slug}`}
              className="text-blue-600 hover:underline"
            >
              {brand.name}
            </Link>
            <span className="mx-2">/</span>
            <Link
              href={`/brands/${slug}/deals`}
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
              href={`/brands/${slug}`}
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
  let brand: BrandData | null = null;
  try {
    brand = await getBrandData(slug);
  } catch {
    return brandCatalogErrorMetadata(slug);
  }

  if (!brand) {
    return { title: 'Brand Cashback Not Found', robots: { index: false, follow: false } };
  }

  return {
    title: `Earn Cashback on ${brand.name} — BuyWhere`,
    description: `Earn cashback on ${brand.name} purchases. Shop through BuyWhere and get rewards back.`,
    alternates: { canonical: `/brands/${slug}/deals/earn` },
  };
}

export async function generateStaticParams() {
  return [];
}
