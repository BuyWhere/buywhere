import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo/SeoLandingPage";
import { buildCheapestProductRouteConfig } from "@/lib/seo-category-route-pages";
import { buildSeoLandingMetadata } from "@/lib/seo-landing-pages";

type Params = { product: string };

type PageProps = {
  params: Promise<Params>;
};

export const dynamicParams = true;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { product } = await params;
  return buildSeoLandingMetadata(buildCheapestProductRouteConfig(product));
}

export default async function CheapestProductPage({ params }: PageProps) {
  const { product } = await params;
  return <SeoLandingPage config={buildCheapestProductRouteConfig(product)} />;
}
