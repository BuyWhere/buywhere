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

export default async function BrandsBrandDealsPage({ params }: PageProps) {
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
    '@type': 'CollectionPage',
    name: `${brand.name} Deals — BuyWhere`,
    description: `Find the best ${brand.name} deals and discounts. Compare prices across retailers.`,
    url: `/brands/${slug}/deals`,
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
            <span>Deals</span>
          </nav>

          <header className="mb-12">
            <h1 className="text-4xl font-bold text-blue-800 mb-4">
              {brand.name} Deals
            </h1>
            <p className="text-lg text-gray-600">
              Find the best {brand.name} deals and discounts across retailers.
            </p>
          </header>

          <section className="text-center py-12">
            <p className="text-gray-500 text-lg">
              No deals available for {brand.name} right now.
            </p>
            <p className="text-gray-400 text-sm mt-2">
              Check back soon for the latest {brand.name} discounts.
            </p>
            <Link
              href={`/brands/${slug}`}
              className="text-blue-600 hover:underline mt-4 inline-block"
            >
              View all {brand.name} products
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
    return { title: 'Brand Deals Not Found', robots: { index: false, follow: false } };
  }

  return {
    title: `${brand.name} Deals — Compare Prices | BuyWhere`,
    description: `Find the best ${brand.name} deals and discounts. Compare prices across retailers.`,
    alternates: { canonical: `/brands/${slug}/deals` },
  };
}

export async function generateStaticParams() {
  return [];
}
