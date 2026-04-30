'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, Search, X } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { MerchantBadge } from '@/components/ui/MerchantBadge';
import { CompareSelectButton } from '@/components/compare/CompareSelectButton';
import { openUpgradeIntentPrompt } from '@/lib/upgrade-intent-prompt';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BUYWHERE_API_URL || 'https://api.buywhere.ai';
const PAGE_SIZE = 20;
const MIN_QUERY_LENGTH = 2;
const SEARCH_HISTORY_KEY = 'bw_search_history';
const SEARCH_HISTORY_LIMIT = 8;
const SUGGESTED_SEARCHES = ['wireless headphones', 'running shoes', 'espresso machine', 'gaming laptop'];

const COUNTRY_OPTIONS = [
  { value: 'us', label: 'United States', apiValue: 'US', currency: 'USD' },
  { value: 'sg', label: 'Singapore', apiValue: 'SG', currency: 'SGD' },
] as const;

type CountryValue = (typeof COUNTRY_OPTIONS)[number]['value'];

type SearchResultsClientProps = {
  initialQuery?: string;
  initialCountry?: string;
};

type SearchApiItem = {
  id: number | string;
  name?: string | null;
  title?: string | null;
  price?: number | string | null;
  currency?: string | null;
  source?: string | null;
  merchant?: string | null;
  image_url?: string | null;
  url?: string | null;
  buy_url?: string | null;
  affiliate_url?: string | null;
  brand?: string | null;
  category?: string | null;
};

type SearchApiResponse = {
  total?: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
  hasMore?: boolean;
  cursor?: string | null;
  next_cursor?: string | null;
  nextCursor?: string | null;
  items?: SearchApiItem[];
  results?: SearchApiItem[];
};

export type SearchCardProduct = {
  id: string;
  name: string;
  price: number | null;
  currency: string;
  merchant: string;
  imageUrl: string | null;
  href: string;
  brand: string | null;
  category: string | null;
};

function normalizeCountry(value?: string): CountryValue {
  return value?.toLowerCase() === 'sg' ? 'sg' : 'us';
}

function getCountryOption(value: CountryValue) {
  return COUNTRY_OPTIONS.find((option) => option.value === value) ?? COUNTRY_OPTIONS[0];
}

function formatMerchantName(value?: string | null) {
  if (!value) return 'BuyWhere seller';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPrice(price: number | null, currency: string) {
  if (price === null) return 'Price unavailable';

  try {
    return new Intl.NumberFormat(currency === 'SGD' ? 'en-SG' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

function normalizeProduct(item: SearchApiItem, fallbackCurrency: string): SearchCardProduct {
  const numericPrice =
    typeof item.price === 'number'
      ? item.price
      : typeof item.price === 'string' && item.price.trim()
        ? Number(item.price)
        : null;

  return {
    id: String(item.id),
    name: item.name || item.title || 'Untitled product',
    price: Number.isFinite(numericPrice) ? numericPrice : null,
    currency: item.currency || fallbackCurrency,
    merchant: formatMerchantName(item.merchant || item.source),
    imageUrl: item.image_url || null,
    href: item.affiliate_url || item.buy_url || item.url || '#',
    brand: item.brand || null,
    category: item.category || null,
  };
}

function normalizeSearchHistoryQuery(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function readSearchHistory() {
  if (typeof window === 'undefined') {
    return [] as string[];
  }

  try {
    const rawValue = window.localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!rawValue) {
      return [] as string[];
    }

    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [] as string[];
    }

    return parsedValue
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeSearchHistoryQuery)
      .filter(Boolean)
      .slice(-SEARCH_HISTORY_LIMIT);
  } catch {
    return [] as string[];
  }
}

function writeSearchHistory(entries: string[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(entries));
}

function mergeSearchHistoryEntry(entries: string[], query: string) {
  const normalizedQuery = normalizeSearchHistoryQuery(query);

  if (normalizedQuery.length < MIN_QUERY_LENGTH) {
    return entries;
  }

  const dedupedEntries = entries.filter((entry) => entry.toLowerCase() !== normalizedQuery.toLowerCase());
  return [...dedupedEntries, normalizedQuery].slice(-SEARCH_HISTORY_LIMIT);
}

function SearchInputSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
      <div className="h-14 animate-pulse rounded-2xl bg-slate-200" />
      <div className="h-14 animate-pulse rounded-2xl bg-slate-200" />
    </div>
  );
}

function SearchResultsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="aspect-[4/3] animate-pulse bg-slate-200" />
          <div className="space-y-3 p-4">
            <div className="h-4 w-2/3 animate-pulse rounded-full bg-slate-200" />
            <div className="h-4 w-full animate-pulse rounded-full bg-slate-100" />
            <div className="h-8 w-1/2 animate-pulse rounded-full bg-amber-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SearchCard({ product }: { product: SearchCardProduct }) {
  return (
    <a
      href={product.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex h-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-amber-200 hover:shadow-xl"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.25),_rgba(248,250,252,0.9)_55%,_rgba(226,232,240,0.9))]">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl text-slate-400">◎</div>
        )}
        <div className="absolute right-2 top-2">
          <CompareSelectButton product={product} className="h-9 w-9" />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <MerchantBadge merchant={product.merchant} className="shrink-0" />
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white">
            Shop
            <ExternalLink className="h-3 w-3" />
          </span>
        </div>

        <div className="space-y-2">
          <h2 className="line-clamp-2 text-lg font-semibold leading-tight text-slate-900 transition-colors group-hover:text-amber-700">
            {product.name}
          </h2>
          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
            {product.brand ? <span>{product.brand}</span> : null}
            {product.category ? <span>{product.category}</span> : null}
          </div>
        </div>

        <div className="mt-auto flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Current price</p>
            <p className="text-2xl font-semibold text-slate-900">{formatPrice(product.price, product.currency)}</p>
          </div>
          <span className="text-sm font-medium text-amber-700">View product</span>
        </div>
      </div>
    </a>
  );
}

export default function SearchResultsClient({
  initialQuery = '',
  initialCountry = 'us',
}: SearchResultsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams?.toString() ?? '';
  const urlSearchParams = useMemo(() => new URLSearchParams(searchParamsString), [searchParamsString]);
  const [isNavigating, startTransition] = useTransition();
  const [query, setQuery] = useState(initialQuery);
  const [country, setCountry] = useState<CountryValue>(normalizeCountry(initialCountry));
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery.trim());
  const [products, setProducts] = useState<SearchCardProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeHistoryIndex, setActiveHistoryIndex] = useState(-1);
  const lastRequestKeyRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchFieldRef = useRef<HTMLLabelElement>(null);

  const persistSearchHistory = useCallback((searchTerm: string) => {
    setSearchHistory((currentHistory) => {
      const nextHistory = mergeSearchHistoryEntry(currentHistory, searchTerm);
      if (nextHistory !== currentHistory) {
        writeSearchHistory(nextHistory);
      }
      return nextHistory;
    });
  }, []);

  const runSearch = useCallback((searchTerm: string) => {
    const normalizedQuery = normalizeSearchHistoryQuery(searchTerm);
    setQuery(normalizedQuery);
    setDebouncedQuery(normalizedQuery);
    setHistoryOpen(false);
    setActiveHistoryIndex(-1);

    if (normalizedQuery.length >= MIN_QUERY_LENGTH) {
      persistSearchHistory(normalizedQuery);
    }
  }, [persistSearchHistory]);

  const removeHistoryEntry = useCallback((entryToRemove: string) => {
    setSearchHistory((currentHistory) => {
      const nextHistory = currentHistory.filter((entry) => entry !== entryToRemove);
      writeSearchHistory(nextHistory);
      return nextHistory;
    });
    setActiveHistoryIndex(-1);
  }, []);

  const clearHistory = useCallback(() => {
    setSearchHistory([]);
    writeSearchHistory([]);
    setHistoryOpen(false);
    setActiveHistoryIndex(-1);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    setSearchHistory(readSearchHistory());
  }, []);

  useEffect(() => {
    const nextQuery = (urlSearchParams.get('q') || '').trim();
    const nextCountry = normalizeCountry(urlSearchParams.get('country') || initialCountry);

    if (nextQuery !== query) {
      setQuery(nextQuery);
      setDebouncedQuery(nextQuery);
    }

    if (nextCountry !== country) {
      setCountry(nextCountry);
    }
  }, [country, initialCountry, query, urlSearchParams]);

  useEffect(() => {
    const normalizedQuery = normalizeSearchHistoryQuery(debouncedQuery);
    if (normalizedQuery.length >= MIN_QUERY_LENGTH) {
      persistSearchHistory(normalizedQuery);
    }
  }, [debouncedQuery, persistSearchHistory]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) {
      params.set('q', debouncedQuery);
    }
    params.set('country', country);

    const nextQueryString = params.toString();
    const currentQueryString = urlSearchParams.toString();

    if (nextQueryString !== currentQueryString) {
      startTransition(() => {
        router.replace(nextQueryString ? `/search?${nextQueryString}` : '/search', { scroll: false });
      });
    }
  }, [country, debouncedQuery, router, urlSearchParams]);

  const activeCountry = useMemo(() => getCountryOption(country), [country]);

  const fetchResults = useCallback(async ({
    mode,
    cursor,
    offsetValue,
    signal,
  }: {
    mode: 'replace' | 'append';
    cursor?: string | null;
    offsetValue?: number;
    signal: AbortSignal;
  }) => {
    const trimmedQuery = debouncedQuery.trim();

    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      setProducts([]);
      setTotal(0);
      setHasMore(false);
      setNextCursor(null);
      setOffset(0);
      setError(null);
      return;
    }

    const params = new URLSearchParams({
      q: trimmedQuery,
      country: activeCountry.apiValue,
      limit: String(PAGE_SIZE),
    });

    if (cursor) {
      params.set('cursor', cursor);
    } else if (offsetValue && offsetValue > 0) {
      params.set('offset', String(offsetValue));
    }

    const requestKey = `${trimmedQuery}:${country}:${cursor ?? offsetValue ?? 0}:${mode}`;
    lastRequestKeyRef.current = requestKey;

    if (mode === 'replace') {
      setLoadingInitial(true);
    } else {
      setLoadingMore(true);
    }

    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/v1/products/search?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
        },
        signal,
      });

      if (response.status === 429) {
        openUpgradeIntentPrompt({
          source: 'search:rate-limit',
          context: 'rate_limit',
          headline: 'You hit the free-tier limit',
          description:
            'Join the Pro launch list and we’ll contact you when higher daily quota is available.',
        });
        throw new Error('Too many requests, try again shortly');
      }

      if (!response.ok) {
        throw new Error('Search results could not be loaded');
      }

      const data: SearchApiResponse = await response.json();
      const rawItems = data.items || data.results || [];
      const normalizedItems = rawItems.map((item) => normalizeProduct(item, activeCountry.currency));

      if (lastRequestKeyRef.current !== requestKey) {
        return;
      }

      let mergedCount = normalizedItems.length;
      setProducts((currentProducts) => {
        const nextItems = mode === 'append' ? [...currentProducts, ...normalizedItems] : normalizedItems;
        mergedCount = nextItems.length;
        return nextItems;
      });
      setTotal(typeof data.total === 'number' ? data.total : mergedCount);
      setHasMore(Boolean(data.has_more ?? data.hasMore ?? normalizedItems.length === PAGE_SIZE));
      setNextCursor(data.next_cursor ?? data.nextCursor ?? null);
      setOffset(typeof data.offset === 'number' ? data.offset : offsetValue ?? 0);
    } catch (caughtError) {
      if (signal.aborted) {
        return;
      }

      setError(caughtError instanceof Error ? caughtError.message : 'Search results could not be loaded');
      if (mode === 'replace') {
        setProducts([]);
        setTotal(0);
        setHasMore(false);
        setNextCursor(null);
        setOffset(0);
      }
    } finally {
      if (mode === 'replace') {
        setLoadingInitial(false);
      } else {
        setLoadingMore(false);
      }
    }
  }, [activeCountry.apiValue, activeCountry.currency, country, debouncedQuery]);

  useEffect(() => {
    const controller = new AbortController();

    void fetchResults({
      mode: 'replace',
      signal: controller.signal,
    });

    return () => controller.abort();
  }, [fetchResults]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (searchFieldRef.current && !searchFieldRef.current.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!historyOpen || query.trim() || searchHistory.length === 0) {
      setActiveHistoryIndex(-1);
    }
  }, [historyOpen, query, searchHistory.length]);

  const showSearchPrompt = debouncedQuery.length < MIN_QUERY_LENGTH;
  const showEmptyState = !loadingInitial && !error && debouncedQuery.length >= MIN_QUERY_LENGTH && products.length === 0;
  const showHistoryDropdown = historyOpen && query.trim().length === 0 && searchHistory.length > 0;
  const reversedSearchHistory = useMemo(() => [...searchHistory].reverse(), [searchHistory]);

  return (
    <div className="flex min-h-screen flex-col bg-[linear-gradient(180deg,_#fff7ed_0%,_#ffffff_28%,_#f8fafc_100%)]">
      <Header />

      <main className="flex-1">
        <section className="border-b border-amber-100 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.22),_rgba(255,247,237,0.85)_38%,_rgba(255,255,255,1)_80%)]">
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-700">Product search</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                Find live catalog results without leaving BuyWhere
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                Search BuyWhere&apos;s product index by query and country, then jump directly to retailer listings.
              </p>
            </div>

            <div className="mt-8 rounded-[32px] border border-white/80 bg-white/80 p-4 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)] backdrop-blur md:p-6">
              {isNavigating && showSearchPrompt ? <SearchInputSkeleton /> : null}

              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                <label ref={searchFieldRef} className="relative block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Search query</span>
                  <Search className="pointer-events-none absolute left-4 top-[3.2rem] h-5 w-5 text-slate-400" aria-hidden="true" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={query}
                    onChange={(event) => {
                      const nextQuery = event.target.value;
                      setQuery(nextQuery);
                      setHistoryOpen(!nextQuery.trim() && searchHistory.length > 0);
                    }}
                    onFocus={() => {
                      if (!query.trim() && searchHistory.length > 0) {
                        setHistoryOpen(true);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setHistoryOpen(false);
                        setActiveHistoryIndex(-1);
                        return;
                      }

                      if (!showHistoryDropdown) {
                        if (event.key === 'Enter' && query.trim().length >= MIN_QUERY_LENGTH) {
                          event.preventDefault();
                          runSearch(query);
                        }
                        return;
                      }

                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setActiveHistoryIndex((currentIndex) =>
                          currentIndex < reversedSearchHistory.length - 1 ? currentIndex + 1 : 0
                        );
                        return;
                      }

                      if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        setActiveHistoryIndex((currentIndex) =>
                          currentIndex > 0 ? currentIndex - 1 : reversedSearchHistory.length - 1
                        );
                        return;
                      }

                      if (event.key === 'Enter') {
                        event.preventDefault();
                        if (activeHistoryIndex >= 0 && activeHistoryIndex < reversedSearchHistory.length) {
                          runSearch(reversedSearchHistory[activeHistoryIndex]);
                        }
                      }
                    }}
                    placeholder="Search sneakers, laptops, espresso machines..."
                    className="h-14 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-base text-slate-900 shadow-sm outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                    aria-label="Search products"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={showHistoryDropdown}
                    aria-controls={showHistoryDropdown ? 'search-history-listbox' : undefined}
                    aria-activedescendant={
                      showHistoryDropdown && activeHistoryIndex >= 0
                        ? `search-history-option-${activeHistoryIndex}`
                        : undefined
                    }
                  />

                  {showHistoryDropdown ? (
                    <div
                      id="search-history-listbox"
                      role="listbox"
                      className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-20 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_20px_60px_-32px_rgba(15,23,42,0.45)]"
                    >
                      <div className="border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Recent searches
                      </div>
                      <ul className="py-2">
                        {reversedSearchHistory.map((entry, index) => (
                          <li
                            key={`${entry}-${index}`}
                            id={`search-history-option-${index}`}
                            role="option"
                            aria-selected={activeHistoryIndex === index}
                            className={`flex items-center gap-3 px-4 py-3 transition ${
                              activeHistoryIndex === index ? 'bg-amber-50' : 'hover:bg-slate-50'
                            }`}
                            onMouseEnter={() => setActiveHistoryIndex(index)}
                          >
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-3 text-left"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => runSearch(entry)}
                            >
                              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                              <span className="truncate text-sm font-medium text-slate-900">{entry}</span>
                            </button>
                            <button
                              type="button"
                              className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => removeHistoryEntry(entry)}
                              aria-label={`Delete ${entry} from search history`}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="border-t border-slate-100 bg-slate-50/80 px-4 py-3">
                        <button
                          type="button"
                          className="text-sm font-medium text-amber-700 transition hover:text-amber-800"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={clearHistory}
                        >
                          Clear history
                        </button>
                      </div>
                    </div>
                  ) : null}
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Country</span>
                  <select
                    value={country}
                    onChange={(event) => setCountry(normalizeCountry(event.target.value))}
                    className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 shadow-sm outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                    aria-label="Country selector"
                  >
                    {COUNTRY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <span>Suggested:</span>
                {SUGGESTED_SEARCHES.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => runSearch(suggestion)}
                    className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 font-medium text-amber-800 transition hover:border-amber-300 hover:bg-amber-100"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          {showSearchPrompt ? (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/90 p-8 text-center shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Start browsing</p>
              <h2 className="mt-3 text-2xl font-semibold text-slate-900">Enter at least 2 characters to see results</h2>
              <p className="mt-3 text-slate-600">Try a product type, brand, or category and switch countries as needed.</p>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-[28px] border border-red-200 bg-red-50 p-6 text-red-900 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-red-700">Search unavailable</p>
              <h2 className="mt-2 text-2xl font-semibold">Results could not be loaded</h2>
              <p className="mt-3 text-red-800">{error}</p>
            </div>
          ) : null}

          {!showSearchPrompt && !error ? (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
                    {activeCountry.label}
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold text-slate-950">
                    {loadingInitial ? 'Searching catalog...' : `${total.toLocaleString()} results for “${debouncedQuery}”`}
                  </h2>
                </div>
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 self-start rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                >
                  Back to homepage
                </Link>
              </div>

              {loadingInitial ? <SearchResultsSkeleton /> : null}

              {showEmptyState ? (
                <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">No matches</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                    No products found for “{debouncedQuery}”
                  </h2>
                  <p className="mt-3 max-w-2xl text-slate-600">
                    Try a broader term, switch countries, or start with one of these popular searches.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {SUGGESTED_SEARCHES.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => runSearch(suggestion)}
                        className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {!loadingInitial && products.length > 0 ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {products.map((product) => (
                      <SearchCard key={product.id} product={product} />
                    ))}
                  </div>

                  {hasMore ? (
                    <div className="flex justify-center pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          const controller = new AbortController();
                          const nextOffset = offset + PAGE_SIZE;

                          void fetchResults({
                            mode: 'append',
                            cursor: nextCursor,
                            offsetValue: nextCursor ? undefined : nextOffset,
                            signal: controller.signal,
                          });
                        }}
                        disabled={loadingMore}
                        className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                      >
                        {loadingMore ? 'Loading more...' : 'Load more'}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>

      <Footer />
    </div>
  );
}
