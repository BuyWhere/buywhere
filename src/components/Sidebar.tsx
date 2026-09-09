"use client";

import Link from "next/link";
import { useState } from "react";

interface SidebarProps {
  items: Array<{
    label: string;
    href: string;
    icon?: React.ReactNode;
    badge?: string;
  }>;
  title?: string;
  footer?: React.ReactNode;
}

export default function Sidebar({ items, title, footer }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <aside className="w-64 flex-shrink-0 hidden lg:block">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sticky top-20">
          {title && (
            <h3 className="font-semibold text-gray-900 mb-4 px-3">{title}</h3>
          )}
          <nav>
            <ul className="space-y-1">
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      {item.icon && <span className="text-base">{item.icon}</span>}
                      {item.label}
                    </span>
                    {item.badge && (
                      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {footer && <div className="mt-4 pt-4 border-t border-gray-100">{footer}</div>}
        </div>
      </aside>

      <button
        className="lg:hidden fixed bottom-4 right-4 z-50 p-4 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle sidebar"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {isOpen ? (
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          ) : (
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setIsOpen(false)}
          />
          <aside className="absolute right-0 top-0 h-full w-72 bg-white shadow-xl p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              {title && <h3 className="font-semibold text-gray-900 px-3">{title}</h3>}
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100"
                aria-label="Close sidebar"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4l12 12M16 4L4 16" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <nav>
              <ul className="space-y-1">
                {items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        {item.icon && <span className="text-base">{item.icon}</span>}
                        {item.label}
                      </span>
                      {item.badge && (
                        <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            {footer && <div className="mt-4 pt-4 border-t border-gray-100">{footer}</div>}
          </aside>
        </div>
      )}
    </>
  );
}
