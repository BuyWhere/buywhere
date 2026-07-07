import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo/SeoLandingPage";
import { buildSeoLandingMetadata, seoLandingPages } from "@/lib/seo-landing-pages";

type PageProps = {
  params: { slug: string };
};

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(seoLandingPages).map((slug) => ({ slug }));
}

export function generateMetadata({ params }: PageProps): Metadata {
  const config = seoLandingPages[params.slug];
  if (!config) return { title: "Page Not Found" };

  return buildSeoLandingMetadata(config);
}

export default function SeoLandingSlugPage({ params }: PageProps) {
  const config = seoLandingPages[params.slug];
  if (!config) notFound();

  return <SeoLandingPage config={config} />;
}
