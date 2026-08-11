import type { Metadata } from "next";
import SearchResultsClient from "@/app/search/SearchResultsClient";
import { toSiteUrl } from "@/lib/site-url";

type Params = { product: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { product } = await params;
  const query = product.replace(/-/g, " ");
  const title = `Cheapest ${query} in United States (2026) — BuyWhere`;
  const description = `Find the cheapest ${query} in the United States. Compare live USD prices across retailers and see where to buy right now on BuyWhere.`;
  return {
    title,
    description,
    alternates: {
      canonical: toSiteUrl(`/cheapest/${product}`),
    },
    robots: { index: true, follow: true },
  };
}

export const dynamicParams = true;

export default async function CheapestProductPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { product } = await params;
  return (
    <SearchResultsClient
      initialQuery={product.replace(/-/g, " ")}
      initialCountry="us"
    />
  );
}
