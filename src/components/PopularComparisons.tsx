import Link from "next/link";

const MARKETING_PAGES = [
  {
    slug: "best-gaming-laptops-us",
    title: "Best Gaming Laptops (US 2026)",
    teaser: "Compare prices across 6 top models",
  },
  {
    slug: "iphone-16-price-singapore",
    title: "iPhone 16 Price Singapore",
    teaser: "Best authorized-reseller prices",
  },
  {
    slug: "laptop-singapore",
    title: "Laptop Deals Singapore",
    teaser: "Best ultraportable, gaming, student picks",
  },
  {
    slug: "air-purifier-singapore",
    title: "Air Purifier Picks Singapore",
    teaser: "Haze-season ready, ranked by CADR",
  },
  {
    slug: "best-robot-vacuums-2026",
    title: "Best Robot Vacuums 2026",
    teaser: "Mop, self-empty, pet hair — compared",
  },
] as const;

export { MARKETING_PAGES };

interface PopularComparisonsProps {
  /** "hero" = full card with image; "footer" = compact text-only */
  variant?: "hero" | "footer";
}

export function PopularComparisons({ variant = "hero" }: PopularComparisonsProps) {
  if (variant === "footer") {
    return (
      <section className="border-t border-gray-100 bg-white py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 mb-5">
            Popular comparisons
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {MARKETING_PAGES.map((page) => (
              <Link
                key={page.slug}
                href={`https://buywhere.ai/${page.slug}`}
                className="group rounded-xl border border-gray-100 bg-gray-50 p-4 transition-all hover:border-indigo-200 hover:bg-indigo-50"
              >
                <p className="text-sm font-semibold text-gray-900 group-hover:text-indigo-700 transition-colors leading-snug">
                  {page.title}
                </p>
                <p className="mt-1 text-xs text-slate-500 leading-relaxed">{page.teaser}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white py-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700 mb-2">
            Editor picks
          </p>
          <h2 className="text-3xl font-bold text-gray-900">Popular price guides</h2>
        </div>
        <div className="grid gap-5 grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 lg:grid-cols-5">
          {MARKETING_PAGES.map((page) => (
            <Link
              key={page.slug}
              href={`https://buywhere.ai/${page.slug}`}
              className="group flex flex-col rounded-2xl border border-gray-100 bg-gray-50 overflow-hidden transition-all hover:border-indigo-200 hover:shadow-lg hover:-translate-y-0.5 max-w-[100vw]"
            >
              {/* Placeholder image area */}
              <div className="aspect-[4/3] bg-[radial-gradient(circle_at_top,_rgba(79,70,229,0.12),_rgba(248,250,252,0.9)_70%)] flex items-center justify-center">
                <span className="text-3xl">
                  {page.slug === "best-gaming-laptops-us"
                    ? "🎮"
                    : page.slug === "iphone-16-price-singapore"
                    ? "📱"
                    : page.slug === "laptop-singapore"
                    ? "💻"
                    : page.slug === "air-purifier-singapore"
                    ? "💨"
                    : "🤖"}
                </span>
              </div>
              <div className="p-4 flex flex-col gap-1 flex-1">
                <p className="text-sm font-semibold text-gray-900 leading-snug">{page.title}</p>
                <p className="text-xs text-slate-500 leading-relaxed flex-1">{page.teaser}</p>
                <p className="mt-2 text-xs font-medium text-indigo-600 group-hover:text-indigo-700 transition-colors">
                  Read guide →
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
