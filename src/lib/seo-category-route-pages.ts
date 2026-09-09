import { seoLandingPages, type SeoLandingPageConfig } from "@/lib/seo-landing-pages";

const DEFAULT_COUNTRY = "US" as const;
const DEFAULT_CURRENCY = "USD" as const;
const DEFAULT_LOCALE = "en_US" as const;

const CHEAPEST_LEGACY_SLUGS: Record<string, string> = {
  laptops: "cheapest-laptop-us",
  tvs: "cheapest-tv-us",
  tablets: "cheapest-ipad-us",
};

function titleCaseSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sentenceCaseSlug(slug: string) {
  const label = slug.replace(/-/g, " ").trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function routeFallbackProducts(legacyConfig?: SeoLandingPageConfig) {
  return legacyConfig?.fallbackProducts ?? [];
}

export function buildBestCategoryRouteConfig(category: string): SeoLandingPageConfig {
  // BUY-77342: first check if a matching seoLandingPages entry exists directly
  // (e.g. "laptop-singapore" with country=SG, currency=SGD). If so, use its
  // country/currency/locale/searchQuery so the page fetches the right products.
  const knownConfig = seoLandingPages[category];
  const legacyConfig = seoLandingPages[`best-${category}-us`];
  const categoryLabel = sentenceCaseSlug(category);
  const titleLabel = titleCaseSlug(category);

  // Resolved country/currency: prefer a known seoLandingPages entry, fall back
  // to defaults.  This prevents /best/laptop-singapore from querying "best
  // laptop-singapore" with country=US and rendering zero affiliate links.
  const country = knownConfig?.country ?? DEFAULT_COUNTRY;
  const currency = knownConfig?.currency ?? DEFAULT_CURRENCY;
  const locale = knownConfig?.locale ?? DEFAULT_LOCALE;

  return {
    slug: `best-${category}`,
    title: `Best ${titleLabel} to Compare First | BuyWhere`,
    description: `Compare the best ${categoryLabel.toLowerCase()} across live BuyWhere catalog results, retailer prices, availability, and category buying signals.`,
    heroEyebrow: "Best category guide",
    heroTitle: `Best ${categoryLabel.toLowerCase()} to compare first`,
    heroBody: `Start with the best ${categoryLabel.toLowerCase()} shortlist, then compare live prices, merchants, and availability before you buy.`,
    canonicalPath: `/best/${category}`,
    country,
    currency,
    locale,
    searchQuery: knownConfig?.searchQuery ?? `best ${category.replace(/-/g, " ")}`,
    backupQueries: knownConfig?.backupQueries ?? [category.replace(/-/g, " ")],
    refreshedLabel: knownConfig?.refreshedLabel ?? legacyConfig?.refreshedLabel ?? "Live prices updated regularly",
    productSectionTitle: `Live ${categoryLabel.toLowerCase()} to compare`,
    comparisonSectionTitle: `How to compare ${categoryLabel.toLowerCase()}`,
    comparisonColumns: ["Signal", "Why it matters", "What to check"],
    comparisonRows: [
      {
        Signal: "Price range",
        "Why it matters": "The best option changes quickly when promotions and bundles move.",
        "What to check": "Compare live merchant prices and availability before choosing.",
      },
      {
        Signal: "Fit for intent",
        "Why it matters": "A top-rated product is only useful if it matches how you plan to use it.",
        "What to check": "Prioritize the specs, size, and features that matter for your use case.",
      },
      {
        Signal: "Retailer confidence",
        "Why it matters": "Warranty, returns, and shipping can change the real value of a deal.",
        "What to check": "Review seller names, stock signals, and total checkout context.",
      },
    ],
    highlightSectionTitle: `Best ${categoryLabel.toLowerCase()} buying signals`,
    highlights: [
      {
        title: "Compare live catalog rows",
        body: "BuyWhere keeps the route focused on current catalog matches instead of a static homepage shell.",
      },
      {
        title: "Use price and availability together",
        body: "The lowest visible price is only one signal; stock status and merchant fit matter before purchase.",
      },
      {
        title: "Keep the crawl path intentional",
        body: "This route has its own canonical URL, metadata, H1, and structured data for category-level search intent.",
      },
    ],
    adviceSectionTitle: `How to choose ${categoryLabel.toLowerCase()}`,
    advicePoints: [
      `Start with the ${categoryLabel.toLowerCase()} rows that match your core use case.`,
      "Compare more than one merchant before you treat a price as the best available deal.",
      "Check availability and seller context, not just the product name.",
      "Use BuyWhere search when you want to narrow the shortlist by model, brand, or feature.",
    ],
    faqSectionTitle: `Best ${categoryLabel.toLowerCase()} FAQ`,
    faqs: [
      {
        question: `What is this best ${categoryLabel.toLowerCase()} page for?`,
        answer: `It gives shoppers and crawlers a dedicated route for best ${categoryLabel.toLowerCase()} comparisons instead of falling back to the homepage or generic 404 metadata.`,
      },
      {
        question: "Does BuyWhere rank every product manually?",
        answer: "No. The page combines editorial buying signals with live catalog and merchant data so shoppers can compare quickly.",
      },
      {
        question: "How often can prices change?",
        answer: "Retailer prices and availability can move throughout the day, so use the live product rows and search links before buying.",
      },
    ],
    shopperCta: {
      title: `Search ${categoryLabel.toLowerCase()} deals`,
      body: `Open BuyWhere search for live ${categoryLabel.toLowerCase()} prices and merchant options.`,
      href: `/search?q=${encodeURIComponent(category.replace(/-/g, " "))}`,
      label: "Search live catalog",
    },
    developerCta: {
      title: "Build category comparison into your agent",
      body: "Use the BuyWhere API to retrieve live product search and merchant handoff data for shopping workflows.",
      href: "/developers",
      label: "Explore the API",
    },
    fallbackProducts: routeFallbackProducts(legacyConfig),
  };
}

export function buildCheapestProductRouteConfig(product: string): SeoLandingPageConfig {
  const legacyConfig = seoLandingPages[CHEAPEST_LEGACY_SLUGS[product] ?? `cheapest-${product}-us`];
  const productLabel = sentenceCaseSlug(product);
  const titleLabel = titleCaseSlug(product);

  return {
    slug: `cheapest-${product}`,
    title: `Cheapest ${titleLabel} to Compare First | BuyWhere`,
    description: `Find the cheapest ${productLabel.toLowerCase()} with live BuyWhere catalog results, retailer prices, availability, and merchant handoff context.`,
    heroEyebrow: "Cheapest category guide",
    heroTitle: `Cheapest ${productLabel.toLowerCase()} to compare first`,
    heroBody: `Start with the lowest-price ${productLabel.toLowerCase()} options, then compare live merchants, availability, and seller context before you buy.`,
    canonicalPath: `/cheapest/${product}`,
    country: DEFAULT_COUNTRY,
    currency: DEFAULT_CURRENCY,
    locale: DEFAULT_LOCALE,
    searchQuery: `cheapest ${product.replace(/-/g, " ")}`,
    backupQueries: [product.replace(/-/g, " ")],
    refreshedLabel: legacyConfig?.refreshedLabel ?? "Live prices updated regularly",
    productSectionTitle: `Live low-price ${productLabel.toLowerCase()} matches`,
    comparisonSectionTitle: `How to compare the cheapest ${productLabel.toLowerCase()}`,
    comparisonColumns: ["Signal", "Why it matters", "What to check"],
    comparisonRows: [
      {
        Signal: "Lowest visible price",
        "Why it matters": "Promotions and merchant stock can change which listing is cheapest.",
        "What to check": "Compare current BuyWhere rows before buying.",
      },
      {
        Signal: "Total value",
        "Why it matters": "A cheaper listing can be worse once shipping, warranty, or seller quality is considered.",
        "What to check": "Use merchant and availability context alongside price.",
      },
      {
        Signal: "Product fit",
        "Why it matters": "The cheapest product is only useful if it still matches the specs you need.",
        "What to check": "Narrow by brand, size, model, or feature in search.",
      },
    ],
    highlightSectionTitle: `Cheapest ${productLabel.toLowerCase()} buying signals`,
    highlights: [
      {
        title: "Lead with price, then verify context",
        body: "This route starts from low-price intent but keeps seller and stock details visible before handoff.",
      },
      {
        title: "Use live catalog matches",
        body: "The page renders route-specific content and structured data rather than inheriting homepage metadata.",
      },
      {
        title: "Keep budget-led routes crawlable",
        body: "The canonical URL, H1, and JSON-LD all match the cheapest-category search intent.",
      },
    ],
    adviceSectionTitle: `How to buy cheaper ${productLabel.toLowerCase()}`,
    advicePoints: [
      "Compare at least two merchants before choosing the apparent lowest price.",
      "Check whether a cheaper product is a bundle, older model, accessory, or refurbished item.",
      "Use availability and seller context to avoid false savings.",
      "Search by model or brand when you need a narrower cheapest shortlist.",
    ],
    faqSectionTitle: `Cheapest ${productLabel.toLowerCase()} FAQ`,
    faqs: [
      {
        question: `What is this cheapest ${productLabel.toLowerCase()} page for?`,
        answer: `It gives shoppers and crawlers a dedicated route for cheapest ${productLabel.toLowerCase()} comparisons instead of falling back to homepage metadata or a generic 404 shell.`,
      },
      {
        question: "Is the cheapest listing always the best buy?",
        answer: "Not always. Check merchant reliability, warranty, delivery, and product fit before choosing purely on price.",
      },
      {
        question: "Can prices change after I open the page?",
        answer: "Yes. Retailer prices and stock can change quickly, so re-check the live catalog or merchant page before purchasing.",
      },
    ],
    shopperCta: {
      title: `Search cheapest ${productLabel.toLowerCase()}`,
      body: `Open BuyWhere search for live low-price ${productLabel.toLowerCase()} listings and merchant options.`,
      href: `/search?q=${encodeURIComponent(`cheapest ${product.replace(/-/g, " ")}`)}`,
      label: "Search live catalog",
    },
    developerCta: {
      title: "Build price discovery into your agent",
      body: "Use the BuyWhere API to retrieve live product search and merchant handoff data for shopping workflows.",
      href: "/developers",
      label: "Explore the API",
    },
    fallbackProducts: routeFallbackProducts(legacyConfig),
  };
}
