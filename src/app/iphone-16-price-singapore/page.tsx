import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo/SeoLandingPage";
import { buildSeoLandingMetadata, seoLandingPages } from "@/lib/seo-landing-pages";

const config = seoLandingPages["iphone-16-price-singapore"];

export async function generateMetadata(): Promise<Metadata> {
  return buildSeoLandingMetadata(config);
}

export default function Iphone16PriceSingaporePage() {
  return <SeoLandingPage config={config} />;
}
