"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto flex min-h-[50vh] max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
          <h2 className="text-2xl font-semibold text-gray-900">Something went wrong.</h2>
          <p className="text-sm text-gray-600">
            Refresh the page or try again.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function SentryErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
