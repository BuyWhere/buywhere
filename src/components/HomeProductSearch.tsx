'use client';

import { FormEvent, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

const exampleQueries = ['wireless headphones', 'standing desk', '4k monitor'];
const countryOptions = [
  { value: 'us', label: 'US' },
  { value: 'sg', label: 'Singapore' },
] as const;

export function HomeProductSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState<(typeof countryOptions)[number]['value']>('us');
  const [error, setError] = useState('');
  const errorId = useId();

  const submitQuery = (rawQuery: string) => {
    const nextQuery = rawQuery.trim();

    if (nextQuery.length < 2) {
      setError('Enter at least 2 characters to search products.');
      return;
    }

    setError('');
    router.push(`/search?q=${encodeURIComponent(nextQuery)}&country=${country}`);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitQuery(query);
  };

  return (
    <div className="max-w-3xl mx-auto mb-10">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3"
        noValidate
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-indigo-100"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (error) {
                  setError('');
                }
              }}
              placeholder="Search products (e.g. wireless headphones)..."
              className="w-full rounded-xl border-2 border-white/20 bg-white/10 py-5 pl-14 pr-4 text-lg text-white placeholder-indigo-200 transition-all focus:border-white focus:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
              aria-label="Search products"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              data-tour="search-bar"
            />
          </div>

          <select
            value={country}
            onChange={(event) => setCountry(event.target.value as (typeof countryOptions)[number]['value'])}
            className="h-[66px] rounded-xl border-2 border-white/20 bg-white/10 px-4 text-base font-medium text-white transition-all focus:border-white focus:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
            aria-label="Search country"
          >
            {countryOptions.map((option) => (
              <option key={option.value} value={option.value} className="text-slate-900">
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-center">
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-indigo-700"
          >
            Search catalog
          </button>
        </div>

        <div className="min-h-5" aria-live="polite">
          {error ? (
            <p id={errorId} className="text-sm font-medium text-amber-100">
              {error}
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-indigo-100">
              <span>Try</span>
              {exampleQueries.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setQuery(example);
                    submitQuery(example);
                  }}
                  className="rounded-full border border-white/20 bg-white/10 px-3 py-1 font-medium text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
                >
                  {example}
                </button>
              ))}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

export default HomeProductSearch;
