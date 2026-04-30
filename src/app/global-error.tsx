"use client";

import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/Button";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-20">
        <div className="max-w-lg text-center">
          <div className="mb-8">
            <svg
              width="80"
              height="80"
              viewBox="0 0 28 28"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="mx-auto"
              aria-hidden="true"
            >
              <rect width="28" height="28" rx="6" fill="#4f46e5" />
              <path
                d="M7 10h14M7 14h10M7 18h12"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-red-600 mb-2">500</p>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Something went wrong
          </h1>
          <p className="text-gray-500 mb-8 leading-relaxed">
            We encountered an unexpected error. Our team has been notified and
            we&apos;re working to fix it. Please try again shortly.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/">
              <Button>Go home</Button>
            </Link>
            <Link href="/search">
              <Button variant="secondary">Search products</Button>
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}