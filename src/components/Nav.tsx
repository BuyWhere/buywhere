"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";

const DEV_LINKS = [
  { href: "/developers", label: "Developer Portal", description: "API keys, usage, overview" },
  { href: "/quickstart", label: "Get Started", description: "5-minute quickstart guide" },
  { href: "/integrate", label: "MCP Integration", description: "Add BuyWhere to your AI agent" },
  { href: "/api-reference", label: "API Reference", description: "Full REST & MCP API docs" },
  { href: "/docs", label: "Documentation", description: "Guides, tutorials, examples" },
];

function DevDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-1 hover:text-indigo-600 transition-colors focus:outline-none"
      >
        Developers
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-2 w-60 bg-white rounded-xl border border-gray-100 shadow-lg py-1 z-50"
        >
          {DEV_LINKS.map(({ href, label, description }) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex flex-col px-4 py-3 hover:bg-indigo-50 transition-colors"
            >
              <span className="font-medium text-gray-900 text-sm">{label}</span>
              <span className="text-xs text-gray-500 mt-0.5">{description}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-indigo-600" aria-label="BuyWhere Home">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect width="28" height="28" rx="6" fill="#4f46e5" />
            <path d="M8 11h12l-1 9H9z" stroke="white" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
            <path d="M11 11V9a3 3 0 0 1 6 0v2" stroke="white" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
          <span>BuyWhere</span>
        </Link>

        {/* Desktop nav */}
        <nav id="main-navigation" className="hidden lg:flex items-center gap-6 text-sm font-medium text-gray-600" aria-label="Main navigation">
          <DevDropdown />
          <Link href="/challenge" className="hover:text-indigo-600 transition-colors">Challenge</Link>
          <Link href="/merchants" className="hover:text-indigo-600 transition-colors">Merchants</Link>
          <Link href="/partners" className="hover:text-indigo-600 transition-colors">Partners</Link>
          <Link href="/pricing" className="hover:text-indigo-600 transition-colors">Pricing</Link>
          <Link href="/about" className="hover:text-indigo-600 transition-colors">About</Link>
          <Link href="/blog" className="hover:text-indigo-600 transition-colors">Blog</Link>
          <div className="flex items-center gap-3 ml-4 pl-4 border-l border-gray-200">
            <Link href="/login" className="hover:text-indigo-600 transition-colors">Log In</Link>
            <Link href="/register" className="rounded-lg bg-indigo-600 px-4 py-2 text-white transition-colors hover:bg-indigo-700">
              Sign Up
            </Link>
          </div>
        </nav>

        {/* Mobile hamburger — always rendered so SSR and CSR match. CSS hides on lg+ screens. */}
        <button
          className="lg:hidden p-2 rounded-lg hover:bg-gray-100"
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

      {/* Mobile menu */}
      {open && (
        <nav
          id="mobile-nav"
          className="lg:hidden border-t border-gray-100 bg-white px-4 pb-4 flex flex-col gap-1 text-sm font-medium text-gray-700"
          aria-label="Mobile navigation"
        >
          {/* Developer section */}
          <button
            className="flex items-center justify-between py-2 hover:text-indigo-600 w-full text-left"
            onClick={() => setDevOpen((v) => !v)}
            aria-expanded={devOpen}
          >
            <span>Developers</span>
            <svg
              className={`w-3.5 h-3.5 transition-transform ${devOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {devOpen && (
            <div className="ml-4 flex flex-col gap-1 border-l-2 border-indigo-100 pl-3 mb-1">
              {DEV_LINKS.map(({ href, label, description }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => { setOpen(false); setDevOpen(false); }}
                  className="py-1.5 hover:text-indigo-600"
                >
                  <span className="font-medium">{label}</span>
                  <span className="text-xs text-gray-400 ml-1.5">{description}</span>
                </Link>
              ))}
            </div>
          )}
          <Link href="/challenge" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600">Challenge</Link>
          <Link href="/merchants" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600">Merchants</Link>
          <Link href="/partners" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600">Partners</Link>
          <Link href="/pricing" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600">Pricing</Link>
          <Link href="/about" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600">About</Link>
          <Link href="/blog" onClick={() => setOpen(false)} className="py-2 hover:text-indigo-600">Blog</Link>
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
