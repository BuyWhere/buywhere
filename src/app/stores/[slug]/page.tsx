import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { getCommerceStore, getStoreSearchPath } from "@/lib/commerce-routes";
import { toSiteUrl } from "@/lib/site-url";

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Emergency fix 2026-08-26: the root layout now reads request headers(), which makes an
export const revalidate = 900;

export default async function StoreDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const store = getCommerceStore(slug);

  if (!store) {
    notFound();
  }

  const searchPath = getStoreSearchPath(store);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${store.name} products on BuyWhere`,
    description: `Compare products from ${store.name} in BuyWhere's product catalog.`,
    url: toSiteUrl(`/stores/${store.slug}`),
    numberOfItems: store.productCount,
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main id="main-content" className="flex-1 bg-gradient-to-b from-indigo-50 to-white">
        <section className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900 py-20 text-white">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <nav className="mb-6 text-sm text-indigo-200">
              <Link href="/stores" className="hover:text-white hover:underline">Stores</Link>
              <span className="mx-2">/</span>
              <span>{store.name}</span>
            </nav>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-indigo-200">{store.country}</p>
            <h1 className="mb-4 text-4xl font-bold">{store.name} products</h1>
            <p className="max-w-2xl text-lg leading-relaxed text-indigo-100">
              Browse BuyWhere&rsquo;s normalized catalog coverage for {store.name}. Compare prices, availability, and product matches across the wider indexed market.
            </p>
          </div>
        </section>
        <section className="py-16">
          <div className="mx-auto max-w-4xl px-4 sm:px-6">
            <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
              {store.productCount != null && (
                <p className="mb-4 text-sm font-medium text-gray-500">{store.productCount.toLocaleString()} indexed products</p>
              )}
              <h2 className="mb-3 text-2xl font-bold text-gray-900">Search {store.name}</h2>
              <p className="mb-6 text-gray-600">
                Store detail pages are discovery pages. Use search to view current products and compare {store.name} listings against other retailers.
              </p>
              <Link href={searchPath} className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-indigo-700">
                Search {store.name} products →
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const store = getCommerceStore(slug);

  if (!store) {
    notFound();
  }

  return {
    title: `${store.name} Products — Compare Prices | BuyWhere`,
    description: `Browse ${store.name} products indexed by BuyWhere and compare prices across retailers.`,
    alternates: { canonical: toSiteUrl(`/stores/${store.slug}`) },
    robots: { index: true, follow: true },
  };
}

export function generateStaticParams() {
  return [];
}
