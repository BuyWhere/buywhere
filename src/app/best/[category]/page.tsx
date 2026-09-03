import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo/SeoLandingPage";
import { buildBestCategoryRouteConfig } from "@/lib/seo-category-route-pages";
import { buildSeoLandingMetadata } from "@/lib/seo-landing-pages";

type Params = { category: string };

type PageProps = {
  params: Promise<Params>;
};

export const dynamicParams = true;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category } = await params;
  return buildSeoLandingMetadata(buildBestCategoryRouteConfig(category));
}

export default async function BestCategoryPage({ params }: PageProps) {
  const { category } = await params;
  return <SeoLandingPage config={buildBestCategoryRouteConfig(category)} />;
}
