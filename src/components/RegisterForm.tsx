"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Auth } from "@/lib/auth";
import { persistDeveloperSession } from "@/lib/developer-session";

const USE_CASES = [
  "AI shopping assistant",
  "Price comparison tool",
  "Affiliate recommendation engine",
  "E-commerce analytics",
  "LangChain / CrewAI agent",
  "Other",
];

interface RegisterFormProps {
  onSuccess?: () => void;
}

export default function RegisterForm({ onSuccess }: RegisterFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [useCase, setUseCase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await Auth.register({
        agent_name: name,
        email,
        use_case: useCase || undefined,
      });
      const rawKey = data.api_key;
      await persistDeveloperSession(rawKey);
      if (data.email_verified === false) {
        setApiKey(rawKey);
        setNeedsVerification(true);
      } else {
        router.push("/onboarding");
        onSuccess?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {needsVerification ? (
        <div className="mt-8 space-y-6">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-500/30 dark:bg-amber-500/10">
            <div className="flex items-start gap-3">
              <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-semibold text-amber-800 dark:text-amber-200">Check your email to verify your account</p>
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                  We sent a verification link to <strong>{email}</strong>. Your API key is active with limited
                  rate limits (5 req/min) until you verify.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Your API key</label>
            <div className="mt-2 rounded-2xl border border-slate-300 bg-slate-900 px-4 py-3 dark:border-slate-700">
              <code className="text-sm text-green-400 font-mono break-all">{apiKey}</code>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              Didn&apos;t get the email?
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Check your spam folder, or{" "}
              <a href={`/verify?email=${encodeURIComponent(email)}&resend=1`} className="text-indigo-600 hover:underline dark:text-indigo-300">
                click here to resend
              </a>.
            </p>
          </div>

          <div className="flex gap-3">
            <Link
              href="/dashboard"
              className="inline-flex flex-1 items-center justify-center rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Go to dashboard →
            </Link>
            <Link
              href="/quickstart"
              className="inline-flex flex-1 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              Quickstart guide
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Your name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Smith"
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-400"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@company.com"
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-400"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">What are you building?</span>
            <select
              value={useCase}
              onChange={(e) => setUseCase(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-indigo-400"
            >
              <option value="">Select a use case (optional)</option>
              {USE_CASES.map((uc) => (
                <option key={uc} value={uc}>{uc}</option>
              ))}
            </select>
          </label>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating account...
              </>
            ) : (
              "Get free API key →"
            )}
          </button>

          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Already have a key?{" "}
            <Link href="/login" className="text-indigo-600 hover:underline dark:text-indigo-300">
              Sign in
            </Link>
          </p>
        </form>
      )}
    </>
  );
}