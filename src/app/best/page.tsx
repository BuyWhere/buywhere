import type { Metadata } from "next";
import Link from "next/link";
import { SeoLandingPage } from "@/components/seo/SeoLandingPage";
import {
  buildSeoLandingMetadata,
  seoLandingPages,
  type SeoLandingPageConfig,
} from "@/lib/seo-landing-pages";

const BEST_HUB_CONFIG: SeoLandingPageConfig = {
  slug: "best",
  title: "Best Products on BuyWhere | Compare Top Deals Across Categories",
  description:
    "Browse every /best-* category hub on BuyWhere — gaming laptops, phones, headphones, TVs, and more — then jump into live price comparisons.",
  heroEyebrow: "BuyWhere Hub",
  heroTitle: "Best products to compare first",
  heroBody:
    "Every /best-* category page BuyWhere ships is linked from this hub so crawlers and shoppers can reach every comparison route from one place.",
  canonicalPath: "/best",
  country: "US",
  currency: "USD",
  locale: "en_US",
  searchQuery: "best",
  refreshedLabel: "Updated June 2026",
  productSectionTitle: "Featured best-deal routes",
  comparisonSectionTitle: "Popular best-match routes",
  comparisonColumns: ["Route", "Coverage", "Best for"],
  comparisonRows: [
    { Route: "Best gaming laptops", Coverage: "US laptop comparisons", "Best for": "High-performance notebook buyers" },
    { Route: "Best phones", Coverage: "US smartphone comparisons", "Best for": "Flagship and budget phone shoppers" },
    { Route: "Best headphones", Coverage: "Audio accessories", "Best for": "ANC and wireless audio shoppers" },
    { Route: "Best TVs", Coverage: "Living room displays", "Best for": "Home theater research" },
    { Route: "Best wireless earbuds", Coverage: "Audio accessories", "Best for": "Daily-driver wireless audio" },
  ],
  highlightSectionTitle: "What this hub is for",
  highlights: [
    {
      title: "Start with intent, not a product name",
      body: "Use the route that matches your purchase goal, then drill into a narrower category page once you know the form factor or budget.",
    },
    {
      title: "Compare before you commit",
      body: "The category pages keep prices, merchants, and availability in one place so users can move from research to action faster.",
    },
    {
      title: "Keep the crawl path clean",
      body: "Every /best-* page in the sitemap now resolves from this hub, so internal linking matches the URL surface Google is indexing.",
    },
  ],
  adviceSectionTitle: "How to use it",
  advicePoints: [
    "Start from the category closest to your purchase intent.",
    "Use the full category grid below if you do not see your pick in the curated table.",
    "Use the developer docs when you want to embed BuyWhere into an agent or workflow.",
    "Jump straight to the specific landing page once you know the product class.",
  ],
  faqSectionTitle: "Best hub FAQ",
  faqs: [
    {
      question: "What does the /best page do?",
      answer:
        "It gives shoppers and crawlers a stable entry point that links to every Best category page BuyWhere ships, so no /best-* URL is orphaned from internal navigation.",
    },
    {
      question: "How many /best-* pages does BuyWhere have?",
      answer:
        "This hub currently links every /best-* entry in the seo-landing-pages registry, matching the URLs that resolve from the sitemap.",
    },
    {
      question: "Does this replace category pages?",
      answer:
        "No. It complements them by giving crawlers and users a top-level route that organizes the existing pages under one obvious entry point.",
    },
  ],
  shopperCta: {
    title: "Open the compare hub",
    body: "Search by product name or jump into a category page if you already know what you want.",
    href: "/compare",
    label: "Compare now",
  },
  developerCta: {
    title: "Build with BuyWhere",
    body: "Use the API and docs to power product-search, comparison, and agent workflows.",
    href: "/developers",
    label: "Explore the API",
  },
  fallbackProducts: [],
};

type BestEntry = { slug: string; config: SeoLandingPageConfig };

function getAllBestEntries(): BestEntry[] {
  return Object.entries(seoLandingPages)
    .filter(([slug]) => slug.startsWith("best-"))
    .map(([slug, config]) => ({ slug, config }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function BestCategoryGrid({
  title,
  entries,
}: {
  title: string;
  entries: BestEntry[];
}) {
  return (
    <div className="mt-10">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
        {entries.map(({ slug, config }) => (
          <li key={slug}>
            <Link
              href={`/${slug}`}
              className="block text-sm text-slate-700 hover:text-amber-700 transition-colors"
            >
              {config.heroTitle}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  return buildSeoLandingMetadata(BEST_HUB_CONFIG);
}

export default function BestPage() {
  const allBestEntries = getAllBestEntries();
  const usEntries = allBestEntries.filter((e) => e.config.country === "US");
  const sgEntries = allBestEntries.filter((e) => e.config.country === "SG");
  const otherEntries = allBestEntries.filter(
    (e) => e.config.country !== "US" && e.config.country !== "SG",
  );

  return (
    <>
      <SeoLandingPage config={BEST_HUB_CONFIG} />
      <section className="bg-white py-16 border-t border-slate-200">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-8 max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">
              All best categories
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              Every /best-* page on BuyWhere ({allBestEntries.length})
            </h2>
            <p className="mt-3 text-sm text-slate-600">
              Linked directly from this hub so Google and shoppers can reach every category from one page.
              Same data source as the sitemap.
            </p>
          </div>
          <BestCategoryGrid title="US market" entries={usEntries} />
          {sgEntries.length > 0 ? (
            <BestCategoryGrid title="Singapore market" entries={sgEntries} />
          ) : null}
          {otherEntries.length > 0 ? (
            <BestCategoryGrid title="Other markets" entries={otherEntries} />
          ) : null}
        </div>
      </section>
    </>
  );
}
