'use client';

import Link from 'next/link';
import { useState } from 'react';

interface NavItem {
  label: string;
  href: string;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navigation: NavSection[] = [
  {
    title: 'Getting Started',
    items: [
      { label: 'Quickstart', href: '/quickstart', badge: 'Start here' },
      { label: 'API Playground', href: '/docs', badge: 'Live' },
      { label: 'Runnable Examples', href: '/docs/quickstart', badge: 'New' },
      { label: 'Developer Guide', href: '/docs/developer-guide-shopping-agents' },
      { label: 'Rate Limits', href: '/docs/rate-limits' },
    ],
  },
  {
    title: 'Core API',
    items: [
      { label: 'API Documentation', href: '/docs/API_DOCUMENTATION' },
      { label: 'API Examples', href: '/docs/API_EXAMPLES' },
      { label: 'API Recipes', href: '/docs/recipes', badge: 'New' },
      { label: 'OpenAPI Spec', href: '/openapi.json' },
      { label: 'Examples & Samples', href: '/docs/API_EXAMPLES' },
    ],
  },
  {
    title: 'Advanced',
    items: [
      { label: 'Versioning', href: '/docs/versioning' },
      { label: 'Changelog', href: '/docs/changelog', badge: 'New' },
      { label: 'Developer FAQ', href: '/docs/developer-faq' },
      { label: 'GraphQL Notes', href: '/docs/GRAPHQL' },
      { label: 'Knowledge Base', href: '/docs/knowledge-base/index' },
    ],
  },
  {
    title: 'Integrations',
    items: [
      { label: 'MCP Setup', href: '/integrate', badge: 'Agents' },
      { label: 'MCP Quickstart', href: '/docs/quickstart-mcp' },
      { label: 'Product Behavior', href: '/agents', badge: 'New' },
      { label: 'SDK Reference', href: '/docs/sdks' },
      { label: 'Agent Design Guide', href: '/docs/knowledge-base/best-practices/agent-design' },
    ],
  },
];

export function DocsSidebar() {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    Object.fromEntries(navigation.map((s) => [s.title, true]))
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleSection = (title: string) => {
    setOpenSections((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  return (
    <>
      {/* Mobile toggle button */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed bottom-4 right-4 z-50 p-4 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-colors"
        aria-label={mobileOpen ? "Close documentation navigation menu" : "Open documentation navigation menu"}
        aria-expanded={mobileOpen}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {mobileOpen ? (
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          ) : (
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:sticky top-0 lg:top-20 h-full lg:h-[calc(100vh-5rem)] w-72 bg-white border-r border-slate-200
          transform transition-transform duration-200 ease-out z-40 overflow-y-auto
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="p-6">
          <div className="mb-6">
            <Link href="/docs" className="flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-indigo-600 transition-colors">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 4h12v12H4z" strokeLinecap="round" />
                <path d="M4 8h12M8 4v12" strokeLinecap="round" />
              </svg>
              All Documentation
            </Link>
          </div>

          <div className="mb-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
              New here
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Start with the quickstart, not the full reference. Get a key, make one request, then come back for deeper docs.
            </p>
            <div className="mt-4 grid gap-2">
              <Link
                href="/quickstart"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
              >
                Open quickstart
              </Link>
              <Link
                href="/api-keys"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
              >
                Get API key
              </Link>
            </div>
          </div>

          <nav className="space-y-6">
            {navigation.map((section) => (
              <div key={section.title}>
                <button
                  onClick={() => toggleSection(section.title)}
                  className="flex items-center justify-between w-full text-left mb-2 px-2 py-1"
                >
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {section.title}
                  </span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className={`transition-transform ${openSections[section.title] ? 'rotate-180' : ''}`}
                  >
                    <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {openSections[section.title] && (
                  <ul className="space-y-1">
                    {section.items.map((item) => (
                      <li key={`${section.title}-${item.label}`}>
                        <Link
                          href={item.href}
                          onClick={() => setMobileOpen(false)}
                          className="flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                        >
                          <span>{item.label}</span>
                          {item.badge && (
                            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">
                              {item.badge}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </nav>

          <div className="mt-8 pt-6 border-t border-slate-200">
            <Link
              href="/api-keys"
              className="flex items-center gap-2 w-full px-4 py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors justify-center"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 8a2 2 0 11-4 0 2 2 0 014 0z" strokeLinecap="round" />
                <path d="M8 4V2M4 4v2M8 12V8" strokeLinecap="round" />
              </svg>
              Start free
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}

export default DocsSidebar;
