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

type Params = { product: string; location: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { product, location } = await params;
  const loc = normalizeLocation(location);
  const query = product.replace(/-/g, " ");
  const title = `Cheapest ${query} in ${loc.label} (2026) — BuyWhere`;
  const description = `Find the cheapest ${query} in ${loc.label}. Compare live ${loc.currency} prices across retailers and see where to buy right now on BuyWhere.`;
  return {
    title,
    description,
    alternates: {
      canonical: toSiteUrl(`/cheapest/${product}/${location}`),
    },
    robots: { index: true, follow: true },
  };
}

export const dynamicParams = true;

export default async function CheapestProductLocationPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { product, location } = await params;
  const loc = normalizeLocation(location);
  return (
    <SearchResultsClient
      initialQuery={product.replace(/-/g, " ")}
      initialCountry={loc.code}
    />
  );
}
