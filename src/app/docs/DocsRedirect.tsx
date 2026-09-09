'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DocsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/quickstart');
  }, [router]);
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen flex-col items-center justify-center bg-white text-gray-900 px-4">
      <div className="max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">BuyWhere Docs</p>
        <h1 className="mt-3 text-4xl font-bold text-gray-950">Documentation</h1>
        <p className="mt-4 text-base leading-7 text-gray-600">
          MCP server quickstart, API reference, authentication, rate limits, and integration guides for BuyWhere.
        </p>
        <p className="mt-6 text-sm text-gray-500">Redirecting to documentation quickstart…</p>
      </div>
    </main>
  );
}
