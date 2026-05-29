"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-indigo-600" aria-label="BuyWhere Home">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="28" height="28" rx="6" fill="#4f46e5" />
            <path d="M7 10h14M7 14h10M7 18h12" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span>BuyWhere</span>
        </Link>

        {/* Desktop nav */}
        <nav id="main-navigation" className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600" aria-label="Main navigation">
          <Link href="/quickstart" className="hover:text-indigo-600 transition-colors">Quickstart</Link>
          <Link href="/challenge" className="hover:text-indigo-600 transition-colors">Challenge</Link>
          <Link href="/merchants" className="hover:text-indigo-600 transition-colors">Merchants</Link>
          <Link href="/partners" className="hover:text-indigo-600 transition-colors">Partners</Link>
          <Link href="/pricing" className="hover:text-indigo-600 transition-colors">Pricing</Link>
          <Link href="/about" className="hover:text-indigo-600 transition-colors">About</Link>
          <div className="flex items-center gap-3 ml-4 pl-4 border-l border-gray-200">
            <Link href="/login" className="hover:text-indigo-600 transition-colors">Log In</Link>
            <Link href="/register" className="rounded-lg bg-indigo-600 px-4 py-2 text-white transition-colors hover:bg-indigo-700">
              Sign Up
            </Link>
          </div>
        </nav>

        {/* Mobile hamburger */}
        {isClient && (
          <button
            className="md:hidden p-2 rounded-lg hover:bg-gray-100"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              {open ? (
                <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
          </button>
        )}
      </div>

      {/* Mobile menu */}
      {isClient && open && (
        <nav
          id="mobile-nav"
          className="md:hidden border-t border-gray-100 bg-white px-4 pb-4 flex flex-col gap-3 text-sm font-medium text-gray-700"
          aria-label="Mobile navigation"
        >
          <Link href="/quickstart" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600">Quickstart</Link>
          <Link href="/challenge" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600">Challenge</Link>
          <Link href="/merchants" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600">Merchants</Link>
          <Link href="/partners" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600">Partners</Link>
          <Link href="/pricing" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600">Pricing</Link>
          <Link href="/about" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600">About</Link>
          <div className="pt-3 mt-3 border-t border-gray-100 flex flex-col gap-3">
            <Link href="/login" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600">Log In</Link>
            <Link href="/register" onClick={() => setOpen(false)} className="rounded-lg bg-indigo-600 px-4 py-2 text-center text-white font-semibold">
              Sign Up
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
