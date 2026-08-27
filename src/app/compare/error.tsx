"use client";

// BUY-67036: route-local error boundary so that RSC navigation failures
// during /compare surface a friendly retry UI instead of an opaque 500 body.
import { useEffect } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/Button";

export default function CompareError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Compare route error:", error);
  }, [error]);

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main id="main-content" className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-lg text-center">
          <p className="text-lg font-semibold text-red-600 mb-3">Compare unavailable</p>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            We couldn&apos;t load that comparison
          </h1>
          <p className="text-gray-500 mb-8 leading-relaxed">
            Something hiccupped on our end while loading the comparison. Try the
            query again, or browse categories.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
            <Button onClick={reset}>Try again</Button>
            <Button href="/" variant="secondary">Go home</Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}