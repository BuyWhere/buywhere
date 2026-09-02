import Link from "next/link";

type BlogCompareCtaProps = {
  slug: string;
};

// BUY-72773: the spec's share-link loop only makes sense if the blog footer
// hands the visitor a pre-filled compare URL. The id (`p=`) is the canonical
// product slug the buyer is researching on the source blog; `from` is the
// attribution surface. Kept inline (not a CMS field) so we ship without
// touching every markdown file — the 6 live pages are well-known to the team.
const PRODUCT_QUERY_BY_SLUG: Record<string, string> = {
  "cheapest-macbook-air-m3-12-countries-compared": "macbook-air-m3",
  "compare-headphones-singapore-2026": "headphones",
  "best-laptop-deals-singapore": "laptop",
  "cheapest-iphone-17-singapore-june-2026": "iphone-17",
  "best-laptop-deals-singapore-june-2026": "laptop",
  "iphone-16-vs-iphone-17-upgrade-worth-it-2026": "iphone-17",
};

export default function BlogCompareCta({ slug }: BlogCompareCtaProps) {
  const productQuery = PRODUCT_QUERY_BY_SLUG[slug];
  // If a blog slug isn't in the live map yet, fall back to a generic landing —
  // still surfaces the share-loop surface tag so we can measure lift.
  const href = productQuery
    ? `/compare?p=${encodeURIComponent(productQuery)}&from=blog-${encodeURIComponent(slug)}`
    : `/compare?from=blog-${encodeURIComponent(slug)}`;

  return (
    <aside className="mt-12 rounded-[28px] border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-8 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-600">
        Compare these picks
      </p>
      <h2 className="mt-3 text-2xl font-semibold text-slate-900">
        See live retailer prices for the products in this guide
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
        Open the side-by-side comparison to inspect price, availability, and affiliate
        destinations for every recommendation in this article. The link is shareable — anyone
        you send it to lands on the same comparison view.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={href}
          className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
          data-blog-compare-cta="true"
        >
          Open the comparison →
        </Link>
        <Link
          href="/compare"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700"
        >
          Or browse all categories
        </Link>
      </div>
    </aside>
  );
}