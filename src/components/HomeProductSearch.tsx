'use client';

import { FormEvent, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

const exampleQueries = ['4k monitor', 'standing desk', 'wireless headphones'];
const countryOptions = [
  { value: 'us', label: 'US' },
  { value: 'sg', label: 'Singapore' },
] as const;

type CountryValue = (typeof countryOptions)[number]['value'];

function inferCountryFromQuery(query: string): CountryValue | null {
  const normalizedQuery = query.toLowerCase();

  if (/\b(singapore|sg)\b/.test(normalizedQuery)) {
    return 'sg';
  }

  if (/\b(us|usa|united states|america)\b/.test(normalizedQuery)) {
    return 'us';
  }

  return null;
}

export function HomeProductSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState<CountryValue>('us');
  const [countryTouched, setCountryTouched] = useState(false);
  const [error, setError] = useState('');
  const errorId = useId();

  const submitQuery = (rawQuery: string) => {
    const nextQuery = rawQuery.trim();

    if (nextQuery.length < 2) {
      setError('Enter at least 2 characters to search products.');
      return;
    }

    setError('');
    const searchCountry = countryTouched ? country : inferCountryFromQuery(nextQuery) ?? country;
    router.push(`/search?q=${encodeURIComponent(nextQuery)}&country=${searchCountry}`);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitQuery(query);
  };

  return (
    <div className="max-w-3xl mx-auto mb-10">
      <form
        onSubmit={handleSubmit}
        className="grid gap-3"
        noValidate
      >
        <div className="flex flex-col gap-3 rounded-xl bg-white p-2 shadow-lg ring-1 ring-black/5 sm:gap-2 md:flex-row md:items-stretch md:gap-3">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-500"
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
              placeholder="Search products..."
              className="search-input w-full rounded-lg border border-slate-200 bg-white py-4 pl-14 pr-4 text-lg text-slate-900 placeholder:!text-slate-500 transition-colors focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              aria-label="Search products"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              data-tour="search-bar"
            />
          </div>

          <select
            value={country}
            onChange={(event) => {
              setCountry(event.target.value as CountryValue);
              setCountryTouched(true);
            }}
            className="h-[58px] w-full shrink-0 rounded-lg border border-slate-200 bg-white px-4 text-base font-medium text-slate-900 transition-colors focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 md:w-32 xl:w-36"
            aria-label="Search country"
          >
            {countryOptions.map((option) => (
              <option key={option.value} value={option.value} className="text-slate-900">
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="submit"
            className="inline-flex h-[58px] shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-indigo-600 px-5 text-base font-semibold text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white md:w-auto md:min-w-[8rem] xl:min-w-[10rem]"
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
            <div className="flex flex-row flex-wrap items-center justify-center gap-2 text-sm text-white px-2">
              <span className="font-semibold text-white/90 whitespace-nowrap">Try:</span>
              {exampleQueries.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setQuery(example);
                    submitQuery(example);
                  }}
                  className="rounded-full border border-white bg-white px-3 py-1 font-semibold text-indigo-900 shadow-sm transition-colors hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-indigo-700 text-xs leading-tight"
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
