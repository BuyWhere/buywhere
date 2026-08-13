'use client';

// BUY-69260: route-local error boundary so RSC navigation failures during
// /search navigation degrade to a recoverable UI instead of the global
// /_error page (which surfaces as HTTP 500 to Chrome).
export default function SearchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = (() => {
    try {
      return error?.message ?? 'Unexpected error';
    } catch {
      return 'Unexpected error';
    }
  })();

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-600">Search temporarily unavailable</p>
      <h1 className="mt-3 text-3xl font-semibold text-slate-950">We hit a snag loading search results</h1>
      <p className="mt-4 text-sm text-slate-600">
        {message}. Please try again, or return to the home page to start over.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => {
            try {
              reset();
            } catch {}
          }}
          className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:border-slate-300"
        >
          Home
        </a>
      </div>
    </div>
  );
}
