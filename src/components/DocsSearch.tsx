'use client';

import { useRouter } from 'next/navigation';
import { Autocomplete } from './Autocomplete';
import type { AutocompleteProduct } from './Autocomplete';
import { Zap } from 'lucide-react';

interface DocsSearchProps {
  apiUrl?: string;
}

const EXAMPLE_QUERIES = [
  { label: 'wireless headphones', icon: '🎧' },
  { label: 'iphone 15 pro', icon: '📱' },
  { label: 'gaming laptop', icon: '💻' },
  { label: 'coffee maker', icon: '☕' },
];

export function DocsSearch({ apiUrl = 'https://api.buywhere.ai' }: DocsSearchProps) {
  const router = useRouter();

  const handleSelect = (product: AutocompleteProduct) => {
    router.push(`/product/${product.id}`);
  };

  const handleSearch = (query: string) => {
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <div className="mt-6 max-w-xl">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/20 px-3 py-1 text-xs font-medium text-indigo-200">
          <Zap className="w-3 h-3" aria-hidden="true" />
          Live Demo
        </span>
        <p className="text-sm font-medium text-indigo-200">
          Try a search against our product catalog
        </p>
      </div>
      <Autocomplete
        placeholder="Search products... (e.g., sony wh-1000xm5)"
        onSelect={handleSelect}
        onSearch={handleSearch}
        apiUrl={apiUrl}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Try:</span>
        {EXAMPLE_QUERIES.map((example) => (
          <button
            key={example.label}
            type="button"
            onClick={() => handleSearch(example.label)}
            className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200 hover:bg-white/10 px-2 py-1 rounded-md transition-colors"
          >
            <span aria-hidden="true">{example.icon}</span>
            {example.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500 flex items-center gap-1">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400/70" aria-hidden="true" />
        No API key required — results are proxy-free
      </p>
    </div>
  );
}

export default DocsSearch;