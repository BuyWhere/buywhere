'use client';

import React from 'react';

interface Subcategory {
  id: string;
  name: string;
  productCount?: number;
}

interface SubcategoryNavProps {
  subcategories: Subcategory[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function SubcategoryNav({ subcategories, selectedId, onSelect }: SubcategoryNavProps) {
  return (
    <nav
      className="bg-white border-b border-gray-200 py-4 overflow-x-auto"
      aria-label="Subcategory navigation"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <ul className="flex gap-2" role="tablist">
          {subcategories.map((sub) => (
            <li key={sub.id}>
              <button
                role="tab"
                aria-selected={selectedId === sub.id}
                onClick={() => onSelect(sub.id)}
                className={`flex-shrink-0 px-4 py-2 text-sm font-medium rounded-full transition-all ${
                  selectedId === sub.id
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {sub.name}
                {sub.productCount !== undefined && (
                  <span className="ml-1.5 text-xs opacity-70">({sub.productCount})</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

export default SubcategoryNav;
