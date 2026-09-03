'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PRODUCT_TAXONOMY } from '@/lib/taxonomy';

interface USRetailerSuggestion {
  id: string;
  label: string;
  type: 'retailer';
  icon: string;
}

interface USCategorySuggestion {
  id: string;
  label: string;
  type: 'category';
  icon: string;
}

type Suggestion = USRetailerSuggestion | USCategorySuggestion;

const US_RETAILERS: USRetailerSuggestion[] = [
  { id: 'amazon', label: 'Amazon', type: 'retailer', icon: '📦' },
  { id: 'walmart', label: 'Walmart', type: 'retailer', icon: '🛒' },
  { id: 'target', label: 'Target', type: 'retailer', icon: '🎯' },
  { id: 'bestbuy', label: 'Best Buy', type: 'retailer', icon: '🏪' },
];

const US_CATEGORIES: USCategorySuggestion[] = PRODUCT_TAXONOMY.filter((cat) =>
  cat.regions.includes('us')
).map((cat) => ({
  id: cat.id,
  label: cat.name,
  type: 'category' as const,
  icon: cat.icon,
}));

function filterSuggestions(query: string, suggestions: Suggestion[]): Suggestion[] {
  if (!query.trim()) return [];
  const lowerQuery = query.toLowerCase();
  return suggestions.filter(s => s.label.toLowerCase().includes(lowerQuery));
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

interface USSearchAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  error?: string;
}

export function USSearchAutocomplete({
  value,
  onChange,
  onSubmit,
  placeholder = 'Search products, brands, or categories',
}: USSearchAutocompleteProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const debouncedValue = useDebounce(value, 150);

  const filteredRetailers = filterSuggestions(debouncedValue, US_RETAILERS);
  const filteredCategories = filterSuggestions(debouncedValue, US_CATEGORIES);
  const hasSuggestions = filteredRetailers.length > 0 || filteredCategories.length > 0;

  const allSuggestions = useMemo<Suggestion[]>(
    () => [...filteredRetailers, ...filteredCategories],
    [filteredRetailers, filteredCategories]
  );

  const handleSelect = useCallback((suggestion: Suggestion) => {
    if (suggestion.type === 'retailer') {
      router.push(`/search?q=${encodeURIComponent(suggestion.label)}&region=us&retailer=${suggestion.id}`);
    } else {
      router.push(`/search?q=${encodeURIComponent(suggestion.label)}&region=us&category=${suggestion.id}`);
    }
    setIsOpen(false);
    onChange('');
  }, [router, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || allSuggestions.length === 0) {
      if (e.key === 'Enter') {
        onSubmit(value);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(prev => (prev < allSuggestions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(prev => (prev > 0 ? prev - 1 : allSuggestions.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < allSuggestions.length) {
          handleSelect(allSuggestions[activeIndex]);
        } else {
          onSubmit(value);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setActiveIndex(-1);
        break;
    }
  }, [isOpen, allSuggestions, activeIndex, handleSelect, onSubmit, value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(-1);
    }
  }, [isOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setIsOpen(true);
  };

  const handleFocus = () => {
    if (hasSuggestions || value.trim()) {
      setIsOpen(true);
    }
  };

  const showDropdown = isOpen && hasSuggestions;

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
        </div>
        {value.trim() !== '' && (
          <button
            onClick={() => {
              onChange('');
              setIsOpen(false);
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full p-1 transition-colors duration-200"
            aria-label="Clear search"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18"/>
              <path d="M6 6l12 12"/>
            </svg>
          </button>
        )}
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`w-full h-14 min-h-[56px] pl-12 pr-4 text-base text-[16px] border-2 rounded-lg transition-all duration-200 outline-none
            bg-white
            focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200
            border-gray-200 hover:border-gray-300
            pl-10
            ${value.trim() !== '' ? 'pr-10' : ''}`}
          style={{ fontSize: '16px' }}
          aria-label="Product search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls="us-search-autocomplete-listbox"
          aria-activedescendant={activeIndex >= 0 ? `suggestion-${allSuggestions[activeIndex].id}` : undefined}
        />
      </div>

      {showDropdown && (
        <div
          id="us-search-autocomplete-listbox"
          role="listbox"
          className="absolute z-50 w-full mt-2 bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden"
        >
          {filteredRetailers.length > 0 && (
            <div>
              <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">
                US Retailers
              </div>
              <ul>
                {filteredRetailers.map((suggestion, index) => {
                  const globalIndex = index;
                  return (
                    <li
                      key={suggestion.id}
                      id={`suggestion-${suggestion.id}`}
                      role="option"
                      aria-selected={activeIndex === globalIndex}
                      className={`px-4 py-3 cursor-pointer flex items-center gap-3 transition-colors
                        ${activeIndex === globalIndex ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                      onClick={() => handleSelect(suggestion)}
                      onMouseEnter={() => setActiveIndex(globalIndex)}
                    >
                      <span className="text-xl" aria-hidden="true">{suggestion.icon}</span>
                      <span className="font-medium text-gray-900">{suggestion.label}</span>
                      <span className="text-xs text-gray-400 ml-auto">Filter by retailer</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {filteredCategories.length > 0 && (
            <div>
              <div className={`px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100 ${filteredRetailers.length > 0 ? 'border-t' : ''}`}>
                US Categories
              </div>
              <ul>
                {filteredCategories.map((suggestion, index) => {
                  const globalIndex = filteredRetailers.length + index;
                  return (
                    <li
                      key={suggestion.id}
                      id={`suggestion-${suggestion.id}`}
                      role="option"
                      aria-selected={activeIndex === globalIndex}
                      className={`px-4 py-3 cursor-pointer flex items-center gap-3 transition-colors
                        ${activeIndex === globalIndex ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                      onClick={() => handleSelect(suggestion)}
                      onMouseEnter={() => setActiveIndex(globalIndex)}
                    >
                      <span className="text-xl" aria-hidden="true">{suggestion.icon}</span>
                      <span className="font-medium text-gray-900">{suggestion.label}</span>
                      <span className="text-xs text-gray-400 ml-auto">Filter by category</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default USSearchAutocomplete;