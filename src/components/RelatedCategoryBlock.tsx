import Link from "next/link";

const CATEGORY_CONFIG: Record<
  string,
  { categoryLabel: string; compareCategory: string; siblings: string[] }
> = {
  "best-gaming-laptops-us": {
    categoryLabel: "Laptops",
    compareCategory: "laptops",
    siblings: ["laptop-singapore", "iphone-16-price-singapore"],
  },
  "iphone-16-price-singapore": {
    categoryLabel: "Smartphones",
    compareCategory: "smartphones",
    siblings: ["laptop-singapore", "best-gaming-laptops-us"],
  },
  "laptop-singapore": {
    categoryLabel: "Laptops",
    compareCategory: "laptops",
    siblings: ["best-gaming-laptops-us", "iphone-16-price-singapore"],
  },
  "air-purifier-singapore": {
    categoryLabel: "Home & Living",
    compareCategory: "home-living",
    siblings: ["best-robot-vacuums-2026"],
  },
  "best-robot-vacuums-2026": {
    categoryLabel: "Home & Living",
    compareCategory: "home-living",
    siblings: ["air-purifier-singapore"],
  },
};

const PAGE_TITLES: Record<string, string> = {
  "best-gaming-laptops-us": "Best Gaming Laptops (US 2026)",
  "iphone-16-price-singapore": "iPhone 16 Price Singapore",
  "laptop-singapore": "Laptop Deals Singapore",
  "air-purifier-singapore": "Air Purifier Picks Singapore",
  "best-robot-vacuums-2026": "Best Robot Vacuums 2026",
};

export function RelatedCategoryBlock({ slug }: { slug: string }) {
  const config = CATEGORY_CONFIG[slug];
  if (!config) return null;

  const { categoryLabel, compareCategory, siblings } = config;

  return (
    <section className="border-t border-slate-200 bg-slate-50 py-12">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 mb-5">
          Explore more
        </p>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* Primary compare links */}
          <div className="flex flex-col gap-3 sm:min-w-[200px]">
            <Link
              href="/compare"
              className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
            >
              All comparisons
            </Link>
            <Link
              href={`/compare?category=${compareCategory}`}
              className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:border-indigo-400 hover:bg-indigo-100"
            >
              {categoryLabel} comparisons →
            </Link>
          </div>

          {/* Sibling marketing pages */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-slate-600 mb-1">
              Related guides
            </p>
            <div className="flex flex-wrap gap-2">
              {siblings.map((siblingSlug) => (
                <Link
                  key={siblingSlug}
                  href={`https://buywhere.ai/${siblingSlug}`}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {PAGE_TITLES[siblingSlug] ?? siblingSlug}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
