'use client';

import { useRouter } from 'next/navigation';
import { Autocomplete } from './Autocomplete';
import type { AutocompleteProduct } from './Autocomplete';

interface HeroSearchProps {
  apiUrl?: string;
}

export function HeroSearch({ apiUrl = 'https://api.buywhere.ai' }: HeroSearchProps) {
  const router = useRouter();

  const handleSelect = (product: AutocompleteProduct) => {
    router.push(`/product/${product.id}`);
  };

  const handleSearch = (query: string) => {
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <div className="mt-8 max-w-xl">
      <Autocomplete
        placeholder="Search products, brands, or categories..."
        onSelect={handleSelect}
        onSearch={handleSearch}
        apiUrl={apiUrl}
      />
    </div>
  );
}

export default HeroSearch;