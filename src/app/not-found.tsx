"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
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

export default function NotFound() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}&country=us`);
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-16">
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

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/">
              <Button>Go home</Button>
            </Link>
            <Link href="/deals/us">
              <Button variant="secondary">View today&apos;s deals</Button>
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}