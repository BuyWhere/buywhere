"use client";

import { useSearchParams } from "next/navigation";

// Reads the no-JS form-POST redirect params (?signin=ok | ?error=invalid_key)
// and renders a small feedback banner so the SSR form POST is not a dead end.
export default function LoginFeedback() {
  const params = useSearchParams();
  const signin = params?.get("signin");
  const error = params?.get("error");

  if (signin === "ok") {
    return (
      <div
        role="status"
        className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      >
        Your API key was verified. The developer dashboard needs JavaScript — enable it, then sign in again to open your dashboard.
      </div>
    );
  }

  if (error === "invalid_key") {
    return (
      <div
        role="alert"
        className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        We couldn’t verify that API key. Check the key and try again.
      </div>
    );
  }

  return null;
}
