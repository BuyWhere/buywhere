"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { NotFoundBrand, NotFoundGeneric } from "@/components/not-found/NotFoundContent";

function NotFoundInner() {
  const searchParams = useSearchParams();
  const isBrandNotFound = searchParams?.get("type") === "brand";
  const slug = searchParams?.get("slug") ?? "";

  if (isBrandNotFound && slug) {
    return <NotFoundBrand slug={slug} />;
  }

  return <NotFoundGeneric />;
}

export default function NotFoundContent() {
  return (
    <Suspense fallback={<NotFoundGeneric />}>
      <NotFoundInner />
    </Suspense>
  );
}
