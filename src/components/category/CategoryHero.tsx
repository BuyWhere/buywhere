'use client';

import React from 'react';
import Link from 'next/link';

interface BreadcrumbItem {
  name: string;
  href?: string;
}

interface CategoryHeroProps {
  breadcrumbs: BreadcrumbItem[];
  title: string;
  totalProducts: number;
}

export function CategoryHero({ breadcrumbs, title, totalProducts }: CategoryHeroProps) {
  return (
    <section className="bg-gradient-to-b from-white to-gray-50 py-8 border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex items-center gap-2 text-sm text-gray-500 mb-3" aria-label="Breadcrumb">
          {breadcrumbs.map((item, index) => (
            <React.Fragment key={item.name}>
              {index > 0 && <span className="text-gray-300">›</span>}
              {item.href ? (
                <Link
                  href={item.href}
                  className="hover:text-gray-900 transition-colors"
                >
                  {item.name}
                </Link>
              ) : (
                <span className="text-gray-900 font-medium">{item.name}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-sm text-gray-500">
          {totalProducts.toLocaleString()} products
        </p>
      </div>
    </section>
  );
}

export default CategoryHero;
