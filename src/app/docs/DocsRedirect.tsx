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
      <p className="text-sm text-gray-500">Redirecting to documentation…</p>
    </main>
  );
}
