'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Search, X, Loader2 } from 'lucide-react';
import { trackSearch } from '@/lib/ga4';

export interface AutocompleteProduct {
  id: number;
  name: string;
  price: number | null;
  currency: string;
  source: string;
  brand: string | null;
  image_url: string | null;
}

function SourceBadge({ source }: { source: string }) {
  const normalizedSource = source.toLowerCase();
  const isUsSource = ['amazon', 'walmart', 'target', 'bestbuy', 'ebay', 'costco'].some(s => normalizedSource.includes(s));
  const isSeaSource = ['shopee', 'lazada', 'qoo10', 'tokopedia', 'tiki'].some(s => normalizedSource.includes(s));

  let badgeColor = 'bg-gray-100 text-gray-600';
  if (isUsSource) badgeColor = 'bg-blue-50 text-blue-700';
  if (isSeaSource) badgeColor = 'bg-green-50 text-green-700';

  const displaySource = normalizedSource.includes('_') 
    ? normalizedSource.split('_')[1] || normalizedSource 
    : normalizedSource;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeColor}`}>
      {displaySource}
    </span>
  );
}

interface AutocompleteProps {
  placeholder?: string;
  onSelect?: (product: AutocompleteProduct) => void;
  onSearch?: (query: string) => void;
  apiUrl?: string;
  autoFocus?: boolean;
  className?: string;
}

export function Autocomplete({
  placeholder = 'Search products...',
  onSelect,
  onSearch,
  apiUrl = 'https://api.buywhere.ai',
  autoFocus = false,
  className = '',
}: AutocompleteProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AutocompleteProduct[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  const fetchSuggestions = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('q', searchQuery);
      params.set('limit', '8');

      const res = await fetch(`${apiUrl}/api/v1/search?${params.toString()}`, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`Search failed: ${res.statusText}`);
      }

      const data = await res.json();
      const items = data.items || [];
      setSuggestions(items);
      setIsOpen(true);
      setSelectedIndex(-1);
      trackSearch(searchQuery, items.length);
    } catch {
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(query);
    }, 250);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, fetchSuggestions]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          handleSelect(suggestions[selectedIndex]);
        } else if (query.trim()) {
          onSearch?.(query.trim());
          setIsOpen(false);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  const handleSelect = (product: AutocompleteProduct) => {
    setQuery(product.name);
    setIsOpen(false);
    onSelect?.(product);
  };

  const handleClear = () => {
    setQuery('');
    setSuggestions([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch?.(query.trim());
      setIsOpen(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative">
          <Search
            className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoFocus={autoFocus}
            autoComplete="off"
            aria-label="Search products"
            aria-expanded={isOpen}
            aria-autocomplete="list"
            aria-controls={isOpen ? 'autocomplete-listbox' : undefined}
            role="combobox"
            className={`w-full h-14 pl-12 pr-12 text-base border-2 rounded-lg transition-all duration-200 outline-none
              ${isFocused
                ? 'border-indigo-500 ring-2 ring-indigo-200'
                : 'border-gray-200 hover:border-gray-300'
              }
              focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200`}
            style={{ fontSize: '16px' }}
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Clear search"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {isLoading && 'Searching products...'}
          {!isLoading && isOpen && suggestions.length > 0 && `${suggestions.length} products found`}
          {!isLoading && isOpen && suggestions.length === 0 && query.trim() && 'No products found'}
        </div>

        {isOpen && suggestions.length > 0 && (
          <div
            ref={dropdownRef}
            id="autocomplete-listbox"
            role="listbox"
            className="absolute z-50 w-full mt-2 bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
          >
            <ul className="py-2">
              {suggestions.map((product, index) => (
                <li
                  key={product.id}
                  role="option"
                  aria-selected={selectedIndex === index}
                  className={`px-4 py-3 cursor-pointer flex items-center gap-3 transition-colors
                    ${selectedIndex === index ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                  onClick={() => handleSelect(product)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  {product.image_url ? (
                    <Image
                      src={product.image_url}
                      alt=""
                      width={48}
                      height={48}
                      className="object-cover rounded-lg bg-gray-100 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                      <Search className="w-5 h-5 text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate pr-2">
                      {product.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {product.brand && (
                        <span className="text-xs text-gray-500 truncate">{product.brand}</span>
                      )}
                      <SourceBadge source={product.source} />
                    </div>
                  </div>
                  {product.price !== null && (
                    <span className="text-sm font-semibold text-indigo-600 shrink-0">
                      {product.currency} {product.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/80">
              <button
                type="submit"
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
              >
                View all results for &quot;{query}&quot;
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        )}

        {isOpen && suggestions.length === 0 && !isLoading && query.trim() && (
          <div className="absolute z-50 w-full mt-2 bg-white rounded-xl border border-gray-200 shadow-lg p-4">
            <p className="text-sm text-gray-500 text-center">
              No products found for &quot;{query}&quot;
            </p>
          </div>
        )}

        {isLoading && (
          <div className="absolute z-50 w-full mt-2 bg-white rounded-xl border border-gray-200 shadow-lg p-6">
            <div className="flex items-center justify-center gap-3">
              <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
              <span className="text-sm text-gray-500">Searching products...</span>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

export default Autocomplete;