"use client";

import Link from "next/link";
import { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/Button";
import { Search } from "lucide-react";

const popularLinks = [
  { href: "/compare/electronics", label: "Electronics" },
  { href: "/compare/fashion", label: "Fashion" },
  { href: "/compare/home-living", label: "Home & Living" },
  { href: "/compare/beauty", label: "Beauty" },
  { href: "/compare/sports-outdoors", label: "Sports & Outdoors" },
  { href: "/deals/us", label: "Today's Deals" },
];

const categoryLinks = [
  { href: "/categories/electronics", label: "Electronics" },
  { href: "/categories/fashion", label: "Fashion" },
  { href: "/categories/home-living", label: "Home & Living" },
  { href: "/categories/beauty-health", label: "Beauty & Health" },
  { href: "/categories/grocery", label: "Grocery" },
];

export function NotFoundGeneric() {
  const [query, setQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      window.location.assign(`/search?q=${encodeURIComponent(query.trim())}&country=us`);
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main id="main-content" className="flex-1 flex items-start justify-center px-4 py-16">
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

          <form onSubmit={handleSearch} className="max-w-md mx-auto mb-10">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for products..."
                className="w-full rounded-xl border-2 border-gray-200 bg-white py-3 pl-11 pr-4 text-gray-900 placeholder-gray-400 transition-all focus:border-indigo-500 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                aria-label="Search products"
              />
            </div>
          </form>

          <div className="grid gap-6 sm:grid-cols-2 mb-10 text-left">
            <div className="bg-indigo-50 rounded-xl p-5">
              <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" className="flex-shrink-0" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
                </svg>
                Browse categories
              </h2>
              <ul className="space-y-2">
                {categoryLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-gray-600 hover:text-indigo-600 transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-amber-50 rounded-xl p-5">
              <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" className="flex-shrink-0" aria-hidden="true">
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                </svg>
                Popular searches
              </h2>
              <ul className="space-y-2">
                {popularLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-gray-600 hover:text-amber-600 transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
            <Button href="/">Go home</Button>
            <Button href="/deals/us" variant="secondary">View today&apos;s deals</Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export function NotFoundBrand({ slug }: { slug: string }) {
  const [query, setQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      window.location.assign(`/search?q=${encodeURIComponent(query.trim())}&country=us`);
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main id="main-content" className="flex-1 flex items-start justify-center px-4 py-8 sm:py-12">
        <div className="max-w-2xl w-full text-center">
          {/* Brand tag SVG icon */}
          <div className="mb-8">
            <svg
              width="96"
              height="96"
              viewBox="0 0 96 96"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="mx-auto h-20 w-20 sm:h-24 sm:w-24"
              aria-hidden="true"
            >
              <circle cx="48" cy="48" r="44" fill="#EFF6FF" />
              <path
                d="M22 48L48 22L74 22C77.3 22 80 24.7 80 28V54L54 80L22 48Z"
                fill="#DBEAFE"
                stroke="#2563EB"
                strokeWidth="3"
                strokeLinejoin="round"
              />
              <circle cx="58" cy="36" r="7" fill="#2563EB" />
              <path
                d="M32 52L46 66L66 46"
                stroke="#2563EB"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <p className="text-lg font-semibold text-blue-600 mb-3">404</p>
          <h1 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-4">
            Brand not found
          </h1>
          <p className="text-gray-500 mb-2 leading-relaxed">
            We couldn&apos;t find any products for &ldquo;{slug}&rdquo;.
          </p>
          <p className="text-gray-400 mb-8 text-sm">
            This brand may have been removed from our catalog, or the URL may be incorrect.
          </p>

          <form onSubmit={handleSearch} className="max-w-md mx-auto mb-10">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for products..."
                className="w-full rounded-xl border-2 border-gray-200 bg-white py-3 pl-11 pr-4 text-gray-900 placeholder-gray-400 transition-all focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-100"
                aria-label="Search products"
              />
            </div>
          </form>

          <div className="grid gap-6 sm:grid-cols-2 mb-10 text-left">
            <div className="bg-blue-50 rounded-xl p-5">
              <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#2563EB"
                  strokeWidth="2"
                  className="flex-shrink-0"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
                </svg>
                Browse categories
              </h2>
              <ul className="space-y-2">
                {categoryLinks.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-600 hover:text-blue-600 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-amber-50 rounded-xl p-5">
              <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#d97706"
                  strokeWidth="2"
                  className="flex-shrink-0"
                  aria-hidden="true"
                >
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                </svg>
                Popular searches
              </h2>
              <ul className="space-y-2">
                {popularLinks.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-600 hover:text-amber-600 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center mb-12">
            <Button href="/brands">Browse all brands</Button>
            <Button href="/" variant="secondary">Go home</Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotFoundCategory — amber palette
// Triggered when a category slug is unknown (e.g. /categories/laptops/sg where
// "laptops" is not a valid category slug).
// ---------------------------------------------------------------------------
export function NotFoundCategory({
  slug,
  country,
}: {
  slug: string;
  country: string;
}) {
  const [query, setQuery] = useState("");
  const countryLabel = country ? country.toUpperCase() : "this region";

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      window.location.assign(`/search?q=${encodeURIComponent(query.trim())}&country=us`);
    }
  };

  const knownCategories = [
    { href: "/categories/electronics", label: "Electronics" },
    { href: "/categories/fashion", label: "Fashion" },
    { href: "/categories/home-living", label: "Home & Living" },
    { href: "/categories/beauty-health", label: "Beauty & Health" },
    { href: "/categories/grocery", label: "Grocery" },
  ];

  return (
    <main id="main-content" className="flex-1 flex items-start justify-center px-4 py-8 sm:py-12">
      <div className="max-w-2xl w-full text-center">
        <div className="mb-8">
          <svg
            width="96"
            height="96"
            viewBox="0 0 96 96"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="mx-auto h-20 w-20 sm:h-24 sm:w-24"
            aria-hidden="true"
          >
            <circle cx="48" cy="48" r="44" fill="#FFFBEB" />
            <rect x="24" y="28" width="24" height="32" rx="3" fill="#FDE68A" stroke="#D97706" strokeWidth="3" />
            <rect x="36" y="36" width="24" height="32" rx="3" fill="#FEF3C7" stroke="#D97706" strokeWidth="3" />
            <path d="M36 46h12M36 52h8" stroke="#D97706" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>

        <p className="text-lg font-semibold text-amber-600 mb-3">404</p>
        <h1 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-4">
          Category not found
        </h1>
        <p className="text-gray-500 mb-2 leading-relaxed">
          We couldn&apos;t find a category called{" "}
          <code className="bg-slate-100 rounded px-2 py-0.5 text-sm text-slate-700">{slug}</code>
          {" "}in {countryLabel}.
        </p>
        <p className="text-gray-400 mb-8 text-sm">
          It may have been merged or renamed. Try a related category below.
        </p>

        <form onSubmit={handleSearch} className="max-w-md mx-auto mb-10">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for products..."
              className="w-full rounded-xl border-2 border-gray-200 bg-white py-3 pl-11 pr-4 text-gray-900 placeholder-gray-400 transition-all focus:border-amber-500 focus:outline-none focus:ring-3 focus:ring-amber-100"
              aria-label="Search products"
            />
          </div>
        </form>

        <div className="grid gap-6 sm:grid-cols-2 mb-10 text-left">
          <div className="bg-amber-50 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" className="flex-shrink-0" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
              </svg>
              Browse categories
            </h2>
            <ul className="space-y-2">
              {knownCategories.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-600 hover:text-amber-600 transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-indigo-50 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" className="flex-shrink-0" aria-hidden="true">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
              </svg>
              Popular searches
            </h2>
            <ul className="space-y-2">
              {popularLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-600 hover:text-indigo-600 transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center mb-12">
          <Button href="/categories/electronics">Browse all categories</Button>
          <Button href="/" variant="secondary">Go home</Button>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// NotFoundCompare — purple palette
// Triggered when /compare/{cc1} or /compare/{cc1}/{cc2} is an unsupported
// country pair (e.g. /compare/jp — Japan is not a supported country).
// ---------------------------------------------------------------------------
export function NotFoundCompare({
  country1,
  country2,
}: {
  country1: string;
  country2?: string;
}) {
  const [query, setQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      window.location.assign(`/search?q=${encodeURIComponent(query.trim())}&country=us`);
    }
  };

  const countryLabel = (cc: string) => {
    const labels: Record<string, string> = {
      us: "United States",
      sg: "Singapore",
      my: "Malaysia",
      th: "Thailand",
      id: "Indonesia",
      ph: "Philippines",
      vn: "Vietnam",
    };
    return labels[cc?.toLowerCase()] ?? cc?.toUpperCase() ?? cc;
  };

  const supportedCountries = [
    { href: "/compare/us", label: "United States" },
    { href: "/compare/sg", label: "Singapore" },
  ];

  const mention = country2
    ? `between ${countryLabel(country1)} and ${countryLabel(country2)}`
    : `in ${countryLabel(country1)}`;

  return (
    <main id="main-content" className="flex-1 flex items-start justify-center px-4 py-8 sm:py-12">
      <div className="max-w-2xl w-full text-center">
        <div className="mb-8">
          <svg
            width="96"
            height="96"
            viewBox="0 0 96 96"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="mx-auto h-20 w-20 sm:h-24 sm:w-24"
            aria-hidden="true"
          >
            <circle cx="48" cy="48" r="44" fill="#FAF5FF" />
            <circle cx="34" cy="48" r="14" fill="#EDE9FE" stroke="#7C3AED" strokeWidth="3" />
            <circle cx="62" cy="48" r="14" fill="#EDE9FE" stroke="#7C3AED" strokeWidth="3" />
            <path d="M44 44L52 52M44 52L52 44" stroke="#7C3AED" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>

        <p className="text-lg font-semibold text-purple-600 mb-3">404</p>
        <h1 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-4">
          Compare not available
        </h1>
        <p className="text-gray-500 mb-2 leading-relaxed">
          We don&apos;t compare prices {mention}.
        </p>
        <p className="text-gray-400 mb-4 text-sm">
          BuyWhere currently covers{" "}
          <span className="inline-flex gap-1 flex-wrap justify-center">
            {["us", "sg", "my", "th", "id", "ph", "vn"].map((cc) => (
              <code key={cc} className="bg-slate-100 rounded px-1.5 py-0.5 text-xs text-slate-700">{cc}</code>
            ))}
          </span>
          . Pick a supported country to compare.
        </p>
        <p className="text-gray-400 mb-8 text-sm">
          Multi-country comparison is on the roadmap.
        </p>

        <form onSubmit={handleSearch} className="max-w-md mx-auto mb-10">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for products to compare..."
              className="w-full rounded-xl border-2 border-gray-200 bg-white py-3 pl-11 pr-4 text-gray-900 placeholder-gray-400 transition-all focus:border-purple-500 focus:outline-none focus:ring-3 focus:ring-purple-100"
              aria-label="Search products to compare"
            />
          </div>
        </form>

        <div className="grid gap-6 sm:grid-cols-2 mb-10 text-left">
          <div className="bg-purple-50 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" className="flex-shrink-0" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
              </svg>
              Supported countries
            </h2>
            <ul className="space-y-2">
              {supportedCountries.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-600 hover:text-purple-600 transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-indigo-50 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" className="flex-shrink-0" aria-hidden="true">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
              </svg>
              Popular searches
            </h2>
            <ul className="space-y-2">
              {popularLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-600 hover:text-indigo-600 transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center mb-12">
          <Button href="/compare/us">Compare in US</Button>
          <Button href="/compare/sg" variant="secondary">Compare in Singapore</Button>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// NotFoundProduct — slate palette
// Triggered when /p/{id} or /products/{id} references a delisted or unknown
// product. Note: /products/my (unsupported country) returns bare __next_error__
// today — this component is for the product-not-found case only.
// ---------------------------------------------------------------------------
export function NotFoundProduct({ id }: { id: string }) {
  const [query, setQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      window.location.assign(`/search?q=${encodeURIComponent(query.trim())}&country=us`);
    }
  };

  return (
    <main id="main-content" className="flex-1 flex items-start justify-center px-4 py-8 sm:py-12">
      <div className="max-w-2xl w-full text-center">
        <div className="mb-8">
          <svg
            width="96"
            height="96"
            viewBox="0 0 96 96"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="mx-auto h-20 w-20 sm:h-24 sm:w-24"
            aria-hidden="true"
          >
            <circle cx="48" cy="48" r="44" fill="#F8FAFC" />
            <rect x="28" y="26" width="40" height="44" rx="6" fill="#E2E8F0" stroke="#64748B" strokeWidth="3" />
            <path d="M38 40h20M38 50h14" stroke="#64748B" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="68" cy="66" r="10" fill="#CBD5E1" stroke="#64748B" strokeWidth="2.5" />
            <path d="M64 66h8M68 62v8" stroke="#64748B" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        <p className="text-lg font-semibold text-slate-500 mb-3">404</p>
        <h1 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-4">
          Product not found
        </h1>
        <p className="text-gray-500 mb-2 leading-relaxed">
          Product{" "}
          <code className="bg-slate-100 rounded px-2 py-0.5 text-sm text-slate-700">{id}</code>
          {" "}isn&apos;t in our catalog.
        </p>
        <p className="text-gray-400 mb-8 text-sm">
          It may have been delisted, or the link could be malformed.
        </p>

        <form onSubmit={handleSearch} className="max-w-md mx-auto mb-10">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for the product..."
              className="w-full rounded-xl border-2 border-gray-200 bg-white py-3 pl-11 pr-4 text-gray-900 placeholder-gray-400 transition-all focus:border-slate-500 focus:outline-none focus:ring-3 focus:ring-slate-100"
              aria-label="Search for the product"
            />
          </div>
        </form>

        <div className="grid gap-6 sm:grid-cols-2 mb-10 text-left">
          <div className="bg-slate-100 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" className="flex-shrink-0" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
              </svg>
              Browse categories
            </h2>
            <ul className="space-y-2">
              {categoryLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-600 hover:text-slate-600 transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-amber-50 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" className="flex-shrink-0" aria-hidden="true">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
              </svg>
              Popular searches
            </h2>
            <ul className="space-y-2">
              {popularLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-600 hover:text-amber-600 transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center mb-12">
          <Button href="/search">Search products</Button>
          <Button href="/" variant="secondary">Go home</Button>
        </div>
      </div>
    </main>
  );
}

export default NotFoundGeneric;
