"use client";

import * as Sentry from "@sentry/nextjs";
import type { ReactNode } from "react";

type SentryErrorBoundaryProps = {
  children: ReactNode;
};

function Fallback({
  resetError,
}: {
  error: unknown;
  componentStack: string;
  eventId: string;
  resetError: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-2xl font-semibold text-gray-900">Something went wrong.</h2>
      <p className="text-sm text-gray-600">
        The error has been reported. Refresh the page or try again.
      </p>
      <button
        type="button"
        onClick={resetError}
        className="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
      >
        Try again
      </button>
    </div>
  );
}

export default function SentryErrorBoundary({ children }: SentryErrorBoundaryProps) {
  return <Sentry.ErrorBoundary fallback={Fallback}>{children}</Sentry.ErrorBoundary>;
}
