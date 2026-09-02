import type { Metadata } from "next";
import {
  NotFoundGeneric,
  NotFoundBrand,
  NotFoundCategory,
  NotFoundCompare,
  NotFoundProduct,
} from "@/components/not-found/NotFoundContent";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

export function generateMetadata({
  searchParams,
}: {
  searchParams?: SearchParams;
}): Metadata {
  const type = first(searchParams?.type);
  const titles: Record<string, string> = {
    brand: "Brand not found",
    category: "Category not found",
    compare: "Compare not available",
    product: "Product not found",
  };
  return {
    title: titles[type] ?? "Page not found",
    robots: { index: false, follow: false },
  };
}

export default function NotFoundContent({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const type = first(searchParams?.type);
  const slug = first(searchParams?.slug);
  const country = first(searchParams?.country);
  const country1 = first(searchParams?.country1);
  const country2 = first(searchParams?.country2);
  const id = first(searchParams?.id);

  switch (type) {
    case "brand":
      if (slug) return <NotFoundBrand slug={slug} />;
      break;
    case "category":
      return <NotFoundCategory slug={slug} country={country} />;
    case "compare":
      return <NotFoundCompare country1={country1} country2={country2} />;
    case "product":
      return <NotFoundProduct id={id || undefined} country={country || undefined} />;
  }

  return <NotFoundGeneric />;
}
