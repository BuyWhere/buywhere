"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import AuthNavControls from "@/components/AuthNavControls";
import { useTheme } from "@/lib/use-theme";

export default function Header() {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <header tabIndex={-1} role="banner" aria-label="Site header" className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100 dark:bg-gray-900/90 dark:border-gray-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <Link
          href="/"
          className="flex items-center gap-2 font-bold text-lg text-indigo-600 dark:text-indigo-400"
          aria-label="BuyWhere Home"
          aria-current={isHome ? "page" : undefined}
        >
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="28" height="28" rx="6" fill="#4f46e5" />
            {/* B letterform mark — distinct from hamburger icons. */}
            <path d="M9 9h5.5a3.5 3.5 0 0 1 0 7H9V9z" fill="white" />
            <path d="M9 16h6a3.5 3.5 0 0 1 0 7H9v-7z" fill="white" />
          </svg>
          <span>BuyWhere</span>
        </Link>

        <span className="sr-only">Use Tab to navigate links, Enter to activate</span>
        <nav id="main-navigation" role="navigation" tabIndex={0} className="hidden lg:flex items-center gap-5 text-sm font-medium text-gray-600 dark:text-gray-300" aria-label="Main navigation">
          <Link href="/compare" prefetch={false} className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Compare</Link>
          <Link href="/search" prefetch={false} className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Search</Link>
          <Link href="/deals" prefetch={false} className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Deals</Link>
          <Link href="/blog" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Blog</Link>
          <Link href="/developers" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Developers</Link>
          <AuthNavControls />
        </nav>

        <div className="flex items-center gap-2">
          {/*
            Single dark-mode toggle rendered in the source. The desktop nav
            already has `hidden lg:flex`, so on desktop the toggle is the
            rightmost button next to where the nav ends; on mobile it sits
            next to the hamburger menu. SSR + first paint emit exactly ONE
            button into the DOM, eliminating the duplicate-icon regression.
          */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-600">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-300">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            )}
          </button>
          <button
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
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
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" role="navigation" tabIndex={0} className="lg:hidden border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 pb-4 flex flex-col gap-3 text-sm font-medium text-gray-700 dark:text-gray-300" aria-label="Mobile navigation">
          <Link href="/compare" prefetch={false} onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600 dark:hover:text-indigo-400">Compare</Link>
          <Link href="/search" prefetch={false} onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600 dark:hover:text-indigo-400">Search</Link>
          <Link href="/deals" prefetch={false} onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600 dark:hover:text-indigo-400">Deals</Link>
          <Link href="/blog" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600 dark:hover:text-indigo-400">Blog</Link>
          <Link href="/developers" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600 dark:hover:text-indigo-400">Developers</Link>
          <AuthNavControls mobile onNavigate={() => setOpen(false)} />
        </nav>
      )}
    </header>
  );
}
