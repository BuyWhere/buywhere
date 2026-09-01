"use client";

import { useEffect } from "react";
import Link from "next/link";
import { displayBrandName } from "@/lib/brand-catalog-error";

/**
 * BUY-78751 / BUY-78740 — catalog backend error on a *valid* brand.
 * Do not reuse the 404 / "Brand Not Found" family.
 */
export function BrandCatalogError({ slug }: { slug: string }) {
  const name = displayBrandName(slug);
  useEffect(() => {
    document.getElementById("brand-catalog-error-heading")?.focus();
  }, []);
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center p-8 max-w-lg">
        <h1
          id="brand-catalog-error-heading"
          tabIndex={-1}
          className="text-2xl font-bold text-gray-800 mb-4"
        >
          Temporarily unavailable
        </h1>
        <p role="status" className="text-gray-600 mb-6">
          We&apos;re having trouble loading {name} products right now. This is
          on us — try again in a few minutes, or browse other brands.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
          <a
            href=""
            className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 font-medium"
          >
            Try again
          </a>
          <Link href="/brands" className="text-blue-600 hover:underline">
            Browse brands
          </Link>
          <Link href="/" className="text-gray-500 hover:underline text-sm">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
