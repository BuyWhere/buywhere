import type { Metadata } from "next";
import SearchResultsClient from "@/app/search/SearchResultsClient";
import { toSiteUrl } from "@/lib/site-url";

type Params = { category: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { category } = await params;
  const query = category.replace(/-/g, " ");
  const title = `Best ${query} in United States (2026) — BuyWhere`;
  const description = `Compare the best ${query} prices across retailers in the United States. Live USD pricing, in-stock signals, and merchant ratings on BuyWhere.`;
  return {
    title,
    description,
    alternates: {
      canonical: toSiteUrl(`/best/${category}`),
    },
    robots: { index: true, follow: true },
  };
}

export const dynamicParams = true;

export default async function BestCategoryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { category } = await params;
  return (
    <SearchResultsClient
      initialQuery={category.replace(/-/g, " ")}
      initialCountry="us"
    />
  );
}
