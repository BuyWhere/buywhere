"use client";

import Link from "next/link";
import { useState } from "react";
import AuthNavControls from "@/components/AuthNavControls";
import { useTheme } from "@/lib/use-theme";

export default function Header() {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100 dark:bg-gray-900/90 dark:border-gray-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-indigo-600 dark:text-indigo-400" aria-label="BuyWhere Home">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="28" height="28" rx="6" fill="#4f46e5" />
            <path d="M7 10h14M7 14h10M7 18h12" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span>BuyWhere</span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600 dark:text-gray-300">
          <Link href="/compare" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Compare</Link>
          <Link href="/blog" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Blog</Link>
          <Link href="/quickstart" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Quickstart</Link>
          <Link href="/merchants" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Merchants</Link>
          <Link href="/partners" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Partners</Link>
          <Link href="/pricing" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Pricing</Link>
          <Link href="/about" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">About</Link>
          <Link href="/developers" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Developers</Link>
          <AuthNavControls />
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
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors md:hidden"
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
            className="md:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
            aria-expanded={open}
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
        <div className="md:hidden border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 pb-4 flex flex-col gap-3 text-sm font-medium text-gray-700 dark:text-gray-300">
          <Link href="/compare" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600 dark:hover:text-indigo-400">Compare</Link>
          <Link href="/blog" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600 dark:hover:text-indigo-400">Blog</Link>
          <Link href="/quickstart" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600 dark:hover:text-indigo-400">Quickstart</Link>
          <Link href="/merchants" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600 dark:hover:text-indigo-400">Merchants</Link>
          <Link href="/partners" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600 dark:hover:text-indigo-400">Partners</Link>
          <Link href="/pricing" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600 dark:hover:text-indigo-400">Pricing</Link>
          <Link href="/about" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600 dark:hover:text-indigo-400">About</Link>
          <Link href="/developers" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600 dark:hover:text-indigo-400">Developers</Link>
          <AuthNavControls mobile onNavigate={() => setOpen(false)} />
        </div>
      )}
    </header>
  );
}
