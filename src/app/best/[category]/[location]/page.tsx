import type { Metadata } from "next";
import SearchResultsClient from "@/app/search/SearchResultsClient";
import { toSiteUrl } from "@/lib/site-url";

type LocationInfo = { code: string; label: string; apiValue: string; currency: string };

const SUPPORTED_COUNTRIES: Record<string, LocationInfo> = {
  sg: { code: "sg", label: "Singapore", apiValue: "SG", currency: "SGD" },
  singapore: { code: "sg", label: "Singapore", apiValue: "SG", currency: "SGD" },
  us: { code: "us", label: "United States", apiValue: "US", currency: "USD" },
  "united-states": { code: "us", label: "United States", apiValue: "US", currency: "USD" },
  usa: { code: "us", label: "United States", apiValue: "US", currency: "USD" },
};

function normalizeLocation(raw: string): LocationInfo {
  const key = raw.toLowerCase();
  if (SUPPORTED_COUNTRIES[key]) return SUPPORTED_COUNTRIES[key];
  return {
    code: key,
    label: raw.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    apiValue: key.toUpperCase(),
    currency: "USD",
  };
}

type Params = { category: string; location: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { category, location } = await params;
  const loc = normalizeLocation(location);
  const query = category.replace(/-/g, " ");
  const title = `Best ${query} in ${loc.label} (2026) — BuyWhere`;
  const description = `Compare the best ${query} prices across retailers in ${loc.label}. Live ${loc.currency} pricing, in-stock signals, and merchant ratings on BuyWhere.`;
  return {
    title,
    description,
    alternates: {
      canonical: toSiteUrl(`/best/${category}/${location}`),
    },
    robots: { index: true, follow: true },
  };
}

export const dynamicParams = true;

export default async function BestCategoryLocationPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { category, location } = await params;
  const loc = normalizeLocation(location);
  return (
    <SearchResultsClient
      initialQuery={category.replace(/-/g, " ")}
      initialCountry={loc.code}
    />
  );
}
