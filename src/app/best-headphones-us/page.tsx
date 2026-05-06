import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo/SeoLandingPage";
import { buildSeoLandingMetadata, seoLandingPages } from "@/lib/seo-landing-pages";


const config = seoLandingPages["best-headphones-us"];

export async function generateMetadata(): Promise<Metadata> {
  return buildSeoLandingMetadata(config);
}

export default function BestHeadphonesUsPage() {
  return <SeoLandingPage config={config} />;
}
