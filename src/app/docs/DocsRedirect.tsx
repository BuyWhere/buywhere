'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DocsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/quickstart');
  }, [router]);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white text-gray-900 px-4">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        Documentation
      </h1>
      <p className="mt-3 text-sm text-gray-500">Redirecting to documentation…</p>
    </main>
  );
}
