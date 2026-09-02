import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo/SeoLandingPage";
import {
  buildSeoLandingMetadata,
  getSeoLandingProducts,
  seoLandingPages,
} from "@/lib/seo-landing-pages";

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ "seo-page": string }>;
}

// BUY-67622 v4: thread the live product snapshot into generateMetadata so the
// SEO meta tags (<title>, og:title, twitter:title, og:image:alt) resolve to the
// live catalog floor price — keeping them in sync with the visible H1 that
// SeoLandingPage renders via resolveHeroTitle. getSeoLandingProducts uses
// Next.js fetch caching (revalidate: 60 * 15) so this call is deduplicated
// against the page render's identical fetch, costing effectively zero. If the
// live fetch fails or returns empty, resolveHeroTitle falls back to the
// static config.title, so the metadata generates safely.
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { "seo-page": slug } = await params;
  const config = seoLandingPages[slug];
  if (!config) return { title: "Page Not Found" };
  const products = await getSeoLandingProducts(config);
  return buildSeoLandingMetadata(config, products);
}

export default async function SeoPageRoute({ params }: PageProps) {
  const { "seo-page": slug } = await params;
  const config = seoLandingPages[slug];
  if (!config) notFound();
  return <SeoLandingPage config={config} />;
}

export function generateStaticParams() {
  return Object.keys(seoLandingPages).map((slug) => ({
    "seo-page": slug,
  }));
}
