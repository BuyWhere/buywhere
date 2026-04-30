"use client";

import Link from "next/link";
import { useEffect } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/Button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-lg text-center">
          <div className="mb-10">
            <svg
              width="120"
              height="120"
              viewBox="0 0 120 120"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="mx-auto"
              aria-hidden="true"
            >
              <circle cx="60" cy="60" r="56" fill="#FEF2F2" />
              <circle cx="60" cy="55" r="28" fill="white" stroke="#EF4444" strokeWidth="3" />
              <path d="M52 45l16 16M68 45L52 61" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" />
              <path d="M60 85v10" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" />
              <path d="M56 95h8" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>

          <p className="text-lg font-semibold text-red-600 mb-3">500</p>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Deal gone wrong
          </h1>
          <p className="text-gray-500 mb-8 leading-relaxed text-lg">
            Something hiccupped on our end. Our team has been notified and we&apos;re working to fix it. Try again in a few — the best deals are worth the wait.
          </p>

          <div className="bg-gray-50 rounded-xl p-5 mb-8 text-left">
            <h2 className="font-semibold text-gray-900 mb-2 text-sm">While you wait:</h2>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" className="flex-shrink-0 mt-0.5" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M22 4L12 14.01l-3-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <Link href="/deals/us" className="text-indigo-600 hover:underline">Check today&apos;s deals</Link>
              </li>
              <li className="flex items-start gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" className="flex-shrink-0 mt-0.5" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M22 4L12 14.01l-3-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <a href="https://status.buywhere.ai" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">View system status</a>
              </li>
              <li className="flex items-start gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" className="flex-shrink-0 mt-0.5" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M22 4L12 14.01l-3-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <Link href="/" className="text-indigo-600 hover:underline">Browse the homepage</Link>
              </li>
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={reset}>Try again</Button>
            <Link href="/">
              <Button variant="secondary">Go home</Button>
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}