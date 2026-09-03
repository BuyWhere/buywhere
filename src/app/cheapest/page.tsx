import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo/SeoLandingPage";
import { buildSeoLandingMetadata, type SeoLandingPageConfig } from "@/lib/seo-landing-pages";

const config: SeoLandingPageConfig = {
  slug: "cheapest",
  title: "Cheapest Products on BuyWhere | Lowest Prices Across Categories",
  description:
    "Start with BuyWhere's cheapest product hubs, then jump into live category pages for phones, laptops, TVs, headphones, and more.",
  heroEyebrow: "BuyWhere Hub",
  heroTitle: "Cheapest listings to compare first",
  heroBody:
    "Use this page when price is the first filter. It links to the lowest-price routes and keeps the workflow centered on live comparison pages.",
  canonicalPath: "/cheapest",
  country: "US",
  currency: "USD",
  locale: "en_US",
  searchQuery: "cheapest",
  refreshedLabel: "Updated June 2026",
  productSectionTitle: "Featured lowest-price routes",
  comparisonSectionTitle: "Popular cheapest-match routes",
  comparisonColumns: ["Route", "Coverage", "Best for"],
  comparisonRows: [
    { Route: "Cheapest iPhones", Coverage: "US smartphone comparisons", "Best for": "Apple buyers tracking the lowest visible checkout price" },
    { Route: "Cheapest laptops", Coverage: "US laptop comparisons", "Best for": "Budget notebook shoppers" },
    { Route: "Cheapest TVs", Coverage: "US TV comparisons", "Best for": "Value-focused living room upgrades" },
    { Route: "Cheapest AirPods", Coverage: "Audio accessories", "Best for": "Apple audio shoppers" },
    { Route: "Cheapest MacBooks", Coverage: "US laptop comparisons", "Best for": "Buyers waiting on the best Apple deal" },
    { Route: "Cheapest Dyson", Coverage: "US vacuum and haircare", "Best for": "Dyson cordless and haircare shoppers" },
    { Route: "Cheapest iPads", Coverage: "US tablet comparisons", "Best for": "Apple tablet buyers tracking the lowest visible checkout price" },
    { Route: "Cheapest PS5", Coverage: "US PlayStation consoles and bundles", "Best for": "PlayStation gamers chasing the lowest PS5 deal" },
    { Route: "Cheapest Samsung TVs", Coverage: "US Samsung TV lineup", "Best for": "Samsung TV shoppers watching the lowest visible checkout price" },
    { Route: "Cheapest Nintendo Switch", Coverage: "US Switch consoles and bundles", "Best for": "Nintendo Switch and Switch OLED buyers" },
  ],
  highlightSectionTitle: "Why this hub exists",
  highlights: [
    {
      title: "Price-first shoppers need a stable entry point",
      body: "A dedicated cheapest hub lets shoppers and crawlers land on the low-price path immediately instead of starting from a generic homepage.",
    },
    {
      title: "The lowest visible price still needs context",
      body: "Users still need to check merchant quality, warranty, and stock status before they buy.",
    },
    {
      title: "It keeps the indexing path clean",
      body: "Top-level crawlable pages are easier to maintain than an orphaned URL that returns 404.",
    },
  ],
  adviceSectionTitle: "How to use it",
  advicePoints: [
    "Start from the cheapest page if your buying decision is budget-led.",
    "Move to a category page when you need a more specific product class.",
    "Use the compare hub if you want to check more than one route at once.",
    "Check the API docs if you are wiring price discovery into an agent or workflow.",
  ],
  faqSectionTitle: "Cheapest hub FAQ",
  faqs: [
    {
      question: "What does the /cheapest page do?",
      answer:
        "It gives budget-led shoppers a stable entry point for the lowest-price routes and points them to the category pages with live pricing coverage.",
    },
    {
      question: "Is cheapest always better than best?",
      answer:
        "No. Sometimes the cheapest option is the wrong fit if the seller, warranty, or feature set is weak. The hub exists to start the comparison, not end it.",
    },
    {
      question: "Why keep this separate from the compare hub?",
      answer:
        "A dedicated route captures price-first intent and makes the crawl and navigation path clearer than forcing every user through a generic comparison page.",
    },
  ],
  shopperCta: {
    title: "Open the compare hub",
    body: "Search by product name or jump into the cheapest category page once you know what you want.",
    href: "/compare",
    label: "Compare now",
  },
  developerCta: {
    title: "Build with BuyWhere",
    body: "Use the API and docs to power product-search, comparison, and agent workflows.",
    href: "/developers",
    label: "Explore the API",
  },
  fallbackProducts: [
    { id: "cheapest-iphone-us", name: "Cheapest iPhones", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/cheapest-iphone-us", brand: null, category: "Cheapest hub" },
    { id: "cheapest-laptop-us", name: "Cheapest Laptops", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/cheapest-laptop-us", brand: null, category: "Cheapest hub" },
    { id: "cheapest-tv-us", name: "Cheapest TVs", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/cheapest-tv-us", brand: null, category: "Cheapest hub" },
    { id: "cheapest-airpods-us", name: "Cheapest AirPods", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/cheapest-airpods-us", brand: null, category: "Cheapest hub" },
    { id: "cheapest-macbook-us", name: "Cheapest MacBooks", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/cheapest-macbook-us", brand: null, category: "Cheapest hub" },
    { id: "cheapest-dyson-us", name: "Cheapest Dyson", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/cheapest-dyson-us", brand: null, category: "Cheapest hub" },
    { id: "cheapest-ipad-us", name: "Cheapest iPads", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/cheapest-ipad-us", brand: null, category: "Cheapest hub" },
    { id: "cheapest-ps5-us", name: "Cheapest PS5", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/cheapest-ps5-us", brand: null, category: "Cheapest hub" },
    { id: "cheapest-samsung-tv-us", name: "Cheapest Samsung TVs", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/cheapest-samsung-tv-us", brand: null, category: "Cheapest hub" },
    { id: "cheapest-switch-us", name: "Cheapest Nintendo Switch", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/cheapest-switch-us", brand: null, category: "Cheapest hub" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  return buildSeoLandingMetadata(config);
}

export default function CheapestPage() {
  return <SeoLandingPage config={config} />;
}
