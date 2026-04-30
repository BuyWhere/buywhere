"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { BILLING_TIER_UI, canonicalizeBillingTier, type CanonicalBillingTierName } from "@/lib/billing";
import { persistDeveloperSession } from "@/lib/developer-session";

const PLAN_COPY: Record<Exclude<CanonicalBillingTierName, "free">, { price: string; detail: string }> = {
  pro: {
    price: "$29 / month",
    detail: "50,000 requests per day for production pilots and early customer traffic.",
  },
  scale: {
    price: "$99 / month",
    detail: "200,000 requests per day for heavier workloads and launch-ready integrations.",
  },
};

export default function CheckoutPage() {
  const searchParams = useSearchParams();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestedPlan = canonicalizeBillingTier(searchParams?.get("plan"));
  const plan = requestedPlan === "free" ? null : requestedPlan;

  useEffect(() => {
    const storedKey = window.localStorage.getItem("bw_api_key");
    if (!storedKey) {
      setApiKey(null);
      return;
    }

    setApiKey(storedKey);
    void persistDeveloperSession(storedKey).catch(() => {});
  }, []);

  async function handleCheckout() {
    if (!plan) {
      setError("Choose a paid plan from pricing before starting checkout.");
      return;
    }

    if (!apiKey) {
      setError("Sign in with your API key before starting checkout.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/stripe/checkout-session", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ plan_id: `${plan}_monthly` }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.checkout_url) {
        throw new Error(payload?.detail ?? payload?.error ?? "Unable to start Stripe checkout right now.");
      }

      window.location.assign(payload.checkout_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start Stripe checkout right now.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Nav />

      <section className="flex-1 py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
            <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">
              Stripe checkout
            </div>

            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
              Confirm your BuyWhere plan.
            </h1>

            <p className="mt-4 text-sm leading-7 text-slate-600">
              Review the plan, then continue to Stripe to activate your subscription on the same developer account.
            </p>

            {!plan ? (
              <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
                No paid plan was selected. Start from pricing to choose Pro or Scale first.
              </div>
            ) : (
              <div className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${BILLING_TIER_UI[plan].badgeClassName}`}>
                      {BILLING_TIER_UI[plan].label}
                    </div>
                    <h2 className="mt-4 text-2xl font-semibold text-slate-900">
                      {PLAN_COPY[plan].price}
                    </h2>
                    <p className="mt-2 text-sm leading-7 text-slate-600">
                      {PLAN_COPY[plan].detail}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white px-4 py-3 text-xs uppercase tracking-[0.16em] text-slate-500">
                    Hosted by Stripe
                  </div>
                </div>
              </div>
            )}

            {!apiKey && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                No developer session is active in this browser. Sign in with your API key first so checkout attaches to the right account.
              </div>
            )}

            {error && (
              <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleCheckout}
                disabled={loading || !apiKey || !plan}
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Redirecting to Stripe..." : "Continue to Stripe"}
              </button>
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
