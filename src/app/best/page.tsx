import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo/SeoLandingPage";
import { buildSeoLandingMetadata, type SeoLandingPageConfig } from "@/lib/seo-landing-pages";

const config: SeoLandingPageConfig = {
  slug: "best",
  title: "Best Products on BuyWhere | Compare Top Deals Across Categories",
  description:
    "Start with the best product hubs on BuyWhere, then jump into live category pages for laptops, phones, headphones, TVs, and more.",
  heroEyebrow: "BuyWhere Hub",
  heroTitle: "Best products to compare first",
  heroBody:
    "Use this page as the starting point for high-intent shopping. It links to our strongest category hubs and keeps you close to live price comparison.",
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
    { Route: "Best wireless keyboards", Coverage: "Desk accessories", "Best for": "Creators and office setups" },
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
      body: "A stable top-level hub gives search engines and humans a sensible entry point instead of a dead end.",
    },
  ],
  adviceSectionTitle: "How to use it",
  advicePoints: [
    "Start from the category closest to your purchase intent.",
    "Check the compare hub if you want a broader search across categories.",
    "Use the developer docs when you want to embed BuyWhere into an agent or workflow.",
    "Jump straight to the specific landing page once you know the product class.",
  ],
  faqSectionTitle: "Best hub FAQ",
  faqs: [
    {
      question: "What does the /best page do?",
      answer:
        "It gives shoppers a stable entry point for the highest-intent comparison routes and points them to the category pages that already have live pricing coverage.",
    },
    {
      question: "Why not send everyone directly to search?",
      answer:
        "Some users want a starting point, not an empty search box. A hub page reduces bounce for people who want guidance before they search.",
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
  fallbackProducts: [
    { id: "best-gaming-laptops-us", name: "Best Gaming Laptops", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/best-gaming-laptops-us", brand: null, category: "Best hub" },
    { id: "best-iphones-us", name: "Best iPhones", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/best-iphones-us", brand: null, category: "Best hub" },
    { id: "best-headphones-us", name: "Best Headphones", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/best-headphones-us", brand: null, category: "Best hub" },
    { id: "best-tvs-us", name: "Best TVs", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/best-tvs-us", brand: null, category: "Best hub" },
    { id: "best-wireless-earbuds-us", name: "Best Wireless Earbuds", price: null, currency: "USD", merchant: "BuyWhere", imageUrl: null, href: "/best-wireless-earbuds-us", brand: null, category: "Best hub" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  return buildSeoLandingMetadata(config);
}

export default function BestPage() {
  return <SeoLandingPage config={config} />;
}
