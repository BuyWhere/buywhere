"use client";

import { USSearchAutocomplete } from "@/components/USSearchAutocomplete";

// 2026-08-26: extracted from src/app/us/[category]/page.tsx (a server component) — passing
// onChange/onSubmit from a server component to a client component threw
// "Event handlers cannot be passed to Client Component props" on every request in prod.
export function USCategorySearch({ category, categoryName }: { category: string; categoryName: string }) {
  return (
    <USSearchAutocomplete
      value=""
      onChange={() => {}}
      onSubmit={(query) => {
        window.location.href = `/search?q=${encodeURIComponent(query)}&region=us&category=${category}`;
      }}
      placeholder={`Search ${categoryName.toLowerCase()} products...`}
    />
  );
}
