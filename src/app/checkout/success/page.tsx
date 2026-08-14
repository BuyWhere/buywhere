"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { persistDeveloperSession } from "@/lib/developer-session";

interface SubscriptionSummary {
  tier: string;
  plan_name: string;
  subscription_status: string | null;
  current_period_end: string | null;
  requests_limit: number;
  requests_remaining: number;
}

function formatPeriodEnd(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default function CheckoutSuccessPage() {
  const searchParams = useSearchParams();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sessionId = searchParams?.get("session_id");

  useEffect(() => {
    const storedKey = window.localStorage.getItem("bw_api_key");

    if (!storedKey) {
      setApiKey(null);
      setLoading(false);
      return;
    }

    const key = storedKey;
    setApiKey(key);
    void persistDeveloperSession(key).catch(() => {});

    async function loadSubscription() {
      try {
        const headers: HeadersInit = { "x-api-key": key };
        const response = await fetch("/api/v1/stripe/subscription", {
          credentials: "include",
          headers,
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.detail ?? payload?.error ?? "Unable to load subscription details.");
        }

        setSubscription(payload);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load subscription details.");
      } finally {
        setLoading(false);
      }
    }

    void loadSubscription();
  }, []);

  const currentPeriodEnd = formatPeriodEnd(subscription?.current_period_end ?? null);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Nav />

      <section className="flex-1 py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="rounded-[32px] border border-emerald-200 bg-white p-8 shadow-sm sm:p-10">
            <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              Subscription activated
            </div>

            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
              Your checkout completed successfully.
            </h1>

            <p className="mt-4 text-sm leading-7 text-slate-600">
              Your BuyWhere account has been sent through Stripe checkout. We’re reading back the live subscription state below.
            </p>

            {!sessionId && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                No Stripe session ID was present in the URL. You can still open the dashboard to verify your current plan.
              </div>
            )}

            {!apiKey && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Sign in with your API key on this device to load the subscription summary for this account.
              </div>
            )}

            {error && (
              <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-6">
              {loading ? (
                <p className="text-sm text-slate-600">Loading subscription details...</p>
              ) : subscription ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Current plan
                  </p>
                  <p className="text-2xl font-semibold text-slate-900">{subscription.plan_name}</p>
                  <p className="text-sm text-slate-600">
                    {subscription.subscription_status
                      ? `Stripe status: ${subscription.subscription_status}.`
                      : "The account is on the free plan without an active Stripe subscription."}
                    {currentPeriodEnd ? ` Current period ends ${currentPeriodEnd}.` : ""}
                  </p>
                  <p className="text-sm text-slate-600">
                    {subscription.requests_remaining.toLocaleString()} of {subscription.requests_limit.toLocaleString()} requests remaining today.
                  </p>
                  {sessionId && (
                    <p className="text-xs text-slate-500">Stripe session: {sessionId}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  Subscription details are not available yet. Open the dashboard to refresh the account state.
                </p>
              )}
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                Open dashboard
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Back to pricing
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
