'use client';

import { CategoryFilter } from './CategoryFilter';
import { PRODUCT_TAXONOMY } from '@/lib/taxonomy';

const CATEGORIES: { id: string; label: string }[] = [
  { id: 'all', label: 'All Deals' },
  ...PRODUCT_TAXONOMY.map((cat) => ({ id: cat.id, label: cat.name })),
];

export function CategoryFilterSection() {
  return (
    <CategoryFilter
      categories={CATEGORIES}
      selected="all"
      onSelect={(id) => console.log('Selected:', id)}
    />
  );
}

export default CategoryFilterSection;
