"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  NotFoundGeneric,
  NotFoundBrand,
  NotFoundCategory,
  NotFoundCompare,
  NotFoundProduct,
} from "@/components/not-found/NotFoundContent";

function NotFoundInner() {
  const searchParams = useSearchParams();
  const type = searchParams?.get("type") ?? "";
  const slug = searchParams?.get("slug") ?? "";
  const country = searchParams?.get("country") ?? "";
  const country1 = searchParams?.get("country1") ?? "";
  const country2 = searchParams?.get("country2") ?? "";
  const id = searchParams?.get("id") ?? "";

  switch (type) {
    case "brand":
      if (slug) return <NotFoundBrand slug={slug} />;
      break;
    case "category":
      return (
        <NotFoundCategory
          slug={slug}
          country={country}
        />
      );
    case "compare":
      return (
        <NotFoundCompare
          country1={country1}
          country2={country2}
        />
      );
    case "product":
      // Support both id= (product not found) and country= (unsupported country)
      return <NotFoundProduct id={id || undefined} country={country || undefined} />;
  }

  // Fall-through: no recognised type, or missing required params
  return <NotFoundGeneric />;
}

export default function NotFoundContent() {
  return (
    <Suspense fallback={<NotFoundGeneric />}>
      <NotFoundInner />
    </Suspense>
  );
}
