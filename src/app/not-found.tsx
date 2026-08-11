import type { Metadata } from "next";
import { headers } from "next/headers";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Schema from "@/components/Schema";
import NotFoundSearchForm from "@/components/NotFoundSearchForm";
import { buildWebPageSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";

/**
 * Route-specific metadata for known 404 paths.
 * Maps the requested path to custom title/description so unimplemented routes
 * do not inherit generic homepage metadata.
 */
const KNOWN_404_PATHS: Record<string, { title: string; description: string }> = {
  "/offers": {
    title: "Offers — BuyWhere",
    description:
      "Browse current product offers, bundles, and promotions across BuyWhere retailers. Find exclusive deals on electronics, home goods, and more.",
  },
  "/offers/us": {
    title: "US Offers — BuyWhere",
    description:
      "Browse current US product offers and promotions from Amazon, Walmart, Target, and Best Buy on BuyWhere.",
  },
  "/price-history": {
    title: "Price History — BuyWhere",
    description:
      "Track price history for products across BuyWhere retailers. See historical price trends to find the best time to buy.",
  },
  "/price-history/iphone": {
    title: "iPhone Price History — BuyWhere",
    description:
      "Track iPhone price history across Amazon, Walmart, Best Buy, and other retailers. Find the best time to buy with historical price data.",
  },
  "/price-drop": {
    title: "Price Drops — BuyWhere",
    description:
      "Find the latest price drops across all BuyWhere retailers. Get notified when products you care about drop in price.",
  },
  "/price-drop/iphone": {
    title: "iPhone Price Drops — BuyWhere",
    description:
      "Track iPhone price drops from Amazon, Walmart, Best Buy, and other retailers. See real-time price reductions on iPhones.",
  },
  "/promo": {
    title: "Promotions — BuyWhere",
    description:
      "Browse active promotions and promotional offers across BuyWhere retailers. Find deals on electronics, fashion, home goods, and more.",
  },
  "/sale": {
    title: "Sale — BuyWhere",
    description:
      "Browse sale items and special offers across BuyWhere retailers. Find discounted products across all categories.",
  },
  "/sale/us": {
    title: "US Sale — BuyWhere",
    description:
      "Browse sale items from Amazon, Walmart, Target, and Best Buy on BuyWhere. Find discounted electronics, home goods, and more.",
  },
  "/reference": {
    title: "API Reference — BuyWhere",
    description:
      "Browse the BuyWhere API reference documentation. Integrate our product search and price comparison API into your applications.",
  },
  "/api-docs": {
    title: "API Documentation — BuyWhere",
    description:
      "BuyWhere API documentation. Learn how to integrate product search, price comparison, and deal discovery into your AI agents and applications.",
  },
  "/integrations": {
    title: "Page Not Found — Integrations — BuyWhere",
    description:
      "Explore BuyWhere integrations with AI agents, MCP servers, and developer tools. Connect your AI assistant to real-time product search and price comparison.",
  },
  "/download": {
    title: "Page Not Found — Download — BuyWhere",
    description:
      "Download BuyWhere SDKs, client libraries, and CLI tools for integrating product search and price comparison into your AI agents.",
  },
  "/demo": {
    title: "Page Not Found — Demo — BuyWhere",
    description:
      "Try the BuyWhere demo to see AI-powered product search and price comparison in action. Experience real-time results across Southeast Asia and US merchants.",
  },
  "/press": {
    title: "Page Not Found — Press — BuyWhere",
    description:
      "BuyWhere press releases, media coverage, and brand assets. Learn about our AI-powered product catalog API and MCP server for shopping agents.",
  },
  "/security": {
    title: "Page Not Found — Security — BuyWhere",
    description:
      "BuyWhere security practices, API authentication, data encryption, and compliance information. Enterprise-grade security for AI agent integrations.",
  },
};

function getPathFromHeaders(): string {
  try {
    const headerList = headers();
    const matchedPath = headerList.get("x-matched-path") ?? headerList.get("x-invoke-path");
    if (matchedPath && matchedPath !== "/") {
      const pathname = matchedPath.split("?")[0];
      if (pathname && pathname !== "/not-found") {
        return pathname;
      }
    }
    const referer = headerList.get("referer");
    if (referer) {
      try {
        const url = new URL(referer);
        return url.pathname;
      } catch {
        // Invalid URL, ignore
      }
    }
  } catch {
    // headers() may throw in some edge cases
  }
  return "";
}

function build404Metadata(pathname: string): Metadata {
  const normalizedPath = pathname === "" ? "/" : pathname;
  const knownPath = Object.keys(KNOWN_404_PATHS).find(
    (key) => key === normalizedPath || normalizedPath.startsWith(key + "/")
  );

  if (knownPath) {
    const info = KNOWN_404_PATHS[knownPath];
    return buildPageMetadata({
      title: info.title,
      description: info.description,
      path: normalizedPath,
    });
  }

  // Default fallback: generic 404 metadata
  return buildPageMetadata({
    title: "Page Not Found — BuyWhere",
    description:
      "The page you're looking for doesn't exist. Explore BuyWhere product search, price comparison, and MCP server for AI agents.",
    path: normalizedPath,
  });
}

function build404Schema(pathname: string) {
  const normalizedPath = pathname === "" ? "/" : pathname;
  const knownPath = Object.keys(KNOWN_404_PATHS).find(
    (key) => key === normalizedPath || normalizedPath.startsWith(key + "/")
  );

  if (knownPath) {
    const info = KNOWN_404_PATHS[knownPath];
    return buildWebPageSchema({
      path: normalizedPath,
      name: info.title,
      description: info.description,
    });
  }

  // Default fallback schema
  return buildWebPageSchema({
    path: normalizedPath,
    name: "Page Not Found — BuyWhere",
    description:
      "The page you're looking for doesn't exist. Explore BuyWhere product search and MCP server for AI agents.",
  });
}

export async function generateMetadata(): Promise<Metadata> {
  const pathname = getPathFromHeaders();
  return build404Metadata(pathname);
}

export default function NotFound() {
  const pathname = getPathFromHeaders();
  const schema = build404Schema(pathname);

  return (
    <>
      <Schema data={schema} />
      <div className="flex flex-col min-h-screen">
        <Header />
        <main id="main-content" className="flex-1 flex items-center justify-center px-4 py-16">
          <div className="max-w-2xl w-full text-center">
            <div className="mb-10">
              <svg
                width="120"
                height="120"
                viewBox="0 0 120 120"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="mx-auto"
                aria-hidden="true"
              >
                <circle cx="60" cy="60" r="56" fill="#EEF2FF" />
                <rect x="24" y="30" width="72" height="60" rx="8" fill="white" stroke="#4f46e5" strokeWidth="3" />
                <path d="M40 50h40M40 60h30M40 70h35" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round" />
                <circle cx="85" cy="80" r="12" fill="#4f46e5" />
                <path d="M81 80l3 3 6-6" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <text x="60" y="44" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#4f46e5">?</text>
              </svg>
            </div>

            <p className="text-lg font-semibold text-indigo-600 mb-3">404</p>
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              Lost in the aisles?
            </h1>
            <p className="text-gray-500 mb-8 leading-relaxed text-lg">
              Looks like this product wandered off. Even the best deal hunters need a map sometimes.
            </p>

            <NotFoundSearchForm />
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
