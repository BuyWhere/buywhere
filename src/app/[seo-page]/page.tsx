import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo/SeoLandingPage";
import { buildSeoLandingMetadata, seoLandingPages } from "@/lib/seo-landing-pages";

interface PageProps {
  params: Promise<{ "seo-page": string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { "seo-page": slug } = await params;
  const config = seoLandingPages[slug];
  if (!config) return { title: "Page Not Found" };
  return buildSeoLandingMetadata(config);
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
