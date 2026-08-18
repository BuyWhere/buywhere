"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function ServerSideLoginForm() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError("Please enter your API key");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/auth/me", {
        method: "GET",
        headers: {
          "x-api-key": apiKey.trim(),
        },
      });

      if (response.ok) {
        // Store the API key
        window.localStorage.setItem("bw_api_key", apiKey.trim());
        router.push("/dashboard");
      } else {
        setError("Invalid API key. Please check and try again.");
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
      <label htmlFor="api-key-input" className="block">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">API key</span>
        <input
          id="api-key-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="bw_live_xxxxxxxxxxxxxxxxx"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-400"
        />
      </label>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
        <a
          href="/api-keys"
          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800"
        >
          Create a new key
        </a>
        <a
          href="/quickstart"
          className="inline-flex items-center justify-center rounded-xl text-sm font-semibold text-indigo-700 transition hover:text-indigo-600 dark:text-indigo-300 dark:hover:text-indigo-200"
        >
          View quickstart
        </a>
      </div>
    </form>
  );
}