"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BILLING_TIER_UI,
  FALLBACK_BILLING_TIERS,
  canonicalizeBillingTier,
  formatPriceMonthly,
  normalizeBillingTiers,
  type BillingStatus,
  type BillingTierDefinition,
  type CanonicalBillingTierName,
} from "@/lib/billing";

const planFeatures: Record<CanonicalBillingTierName, string[]> = {
  free: [
    "100 requests per day",
    "Structured product search",
    "Cross-merchant price comparison",
    "BuyWhere MCP compatibility",
  ],
  pro: [
    "50,000 requests per day",
    "Hosted Stripe subscription checkout",
    "Ideal for production pilots",
    "Quota visibility in the dashboard",
  ],
  scale: [
    "200,000 requests per day",
    "Production-scale quota headroom",
    "Priority support path",
    "Best fit for live agent workloads",
  ],
};

interface ComparisonRow {
  feature: string;
  free: string;
  pro: string;
  scale: string;
}

const comparisonRows: ComparisonRow[] = [
  { feature: "Daily requests", free: "100", pro: "50,000", scale: "200,000" },
  { feature: "API endpoints", free: "Search only", pro: "All endpoints", scale: "All endpoints" },
  { feature: "Search filters", free: "Basic", pro: "Advanced", scale: "Advanced" },
  { feature: "Priority support", free: "Community", pro: "24h SLA", scale: "Dedicated path" },
  { feature: "Data retention", free: "30 days", pro: "90 days", scale: "90 days" },
  { feature: "Webhooks", free: "No", pro: "Yes", scale: "Yes" },
  { feature: "Bulk ingestion", free: "No", pro: "Yes", scale: "Yes" },
  { feature: "SLA guarantee", free: "No", pro: "No", scale: "Yes" },
  { feature: "Account manager", free: "No", pro: "No", scale: "Yes" },
];

function CheckIcon() {
  return (
    <svg className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PricingClient() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [tiers, setTiers] = useState<BillingTierDefinition[]>(FALLBACK_BILLING_TIERS);
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadBillingState() {
      setLoadingStatus(true);

      try {
        const tiersRes = await fetch("/api/billing/tiers", { cache: "no-store" });
        if (tiersRes.ok) {
          const payload = await tiersRes.json();
          if (!cancelled) {
            setTiers(normalizeBillingTiers(payload));
          }
        }

        const storedKey = window.localStorage.getItem("bw_api_key");
        if (!storedKey) {
          if (!cancelled) {
            setApiKey(null);
            setBillingStatus(null);
          }
          return;
        }

        if (!cancelled) {
          setApiKey(storedKey);
        }

        const statusRes = await fetch("/api/billing/status", {
          headers: { "x-api-key": storedKey },
          cache: "no-store",
        });

        if (statusRes.ok) {
          const payload = await statusRes.json();
          if (!cancelled) {
            setBillingStatus(payload);
          }
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load billing details right now.");
        }
      } finally {
        if (!cancelled) {
          setLoadingStatus(false);
        }
      }
    }

    loadBillingState();

    return () => {
      cancelled = true;
    };
  }, []);

  const orderedTiers = useMemo(() => {
    const order: CanonicalBillingTierName[] = ["free", "pro", "scale"];
    return [...tiers].sort(
      (a, b) => order.indexOf(canonicalizeBillingTier(a.name)) - order.indexOf(canonicalizeBillingTier(b.name))
    );
  }, [tiers]);

  function handleUpgradeClick(tier: CanonicalBillingTierName) {
    setError(null);
    router.push(`/checkout?plan=${tier}`);
  }

  return (
    <>
      <section className="border-b border-gray-100 bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
            Stripe checkout is live
          </div>
          <h1 className="mb-4 text-4xl font-bold text-gray-900">
            Pick the API tier that matches your traffic
          </h1>
          <p className="mx-auto max-w-3xl text-lg text-gray-500">
            Start free today, then upgrade to a paid plan in a hosted Stripe checkout flow when your production traffic is ready.
          </p>
        </div>
      </section>

      <section className="bg-gray-50 py-8">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
                  Billing status
                </p>
                <p className="mt-2 text-sm text-gray-600">
                  {loadingStatus
                    ? "Loading your current plan and quota."
                    : billingStatus
                      ? `${BILLING_TIER_UI[canonicalizeBillingTier(billingStatus.tier)].label} plan with ${billingStatus.requests_remaining.toLocaleString()} requests remaining today.`
                      : "No API key found in this browser yet. Create a key first, then upgrade in one click."}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/api-keys"
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                >
                  {apiKey ? "Open dashboard" : "Get API key"}
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Talk to sales
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-gray-50 py-8">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 lg:grid-cols-3">
          {orderedTiers.map((tier) => {
            const canonicalTier = canonicalizeBillingTier(tier.name);
            const ui = BILLING_TIER_UI[canonicalTier];
            const isCurrentPlan = canonicalizeBillingTier(billingStatus?.tier) === canonicalTier;
            const isUpgradeAction = canonicalTier !== "free" && !isCurrentPlan;

            return (
              <article
                key={tier.name}
                className={`rounded-3xl border p-8 shadow-sm ${
                  canonicalTier === "pro"
                    ? "border-indigo-300 bg-white shadow-indigo-100"
                    : "border-gray-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${ui.badgeClassName}`}>
                    {ui.label}
                  </span>
                  {isCurrentPlan && (
                    <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                      Current
                    </span>
                  )}
                </div>

                <div className="mt-6">
                  <div className={`text-4xl font-bold ${ui.accentClassName}`}>
                    {formatPriceMonthly(tier.price_monthly, tier.currency)}
                  </div>
                  <p className="mt-1 text-sm text-gray-400">
                    {tier.price_monthly === 0 ? "No card required" : `per month, billed via Stripe`}
                  </p>
                </div>

                <div className="mt-6 rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">
                    {tier.requests_per_day.toLocaleString()} requests per day
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {tier.description}
                  </p>
                </div>

                <ul className="mt-6 space-y-3 text-sm text-gray-600">
                  {planFeatures[canonicalTier].map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <CheckIcon />
                      {feature}
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  {isUpgradeAction ? (
                    <button
                      type="button"
                      onClick={() => handleUpgradeClick(canonicalTier)}
                      className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
                    >
                      Subscribe to {ui.label}
                    </button>
                  ) : canonicalTier === "free" ? (
                    <Link
                      href="/api-keys"
                      className="inline-flex w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      Get started
                    </Link>
                  ) : (
                    <div className="inline-flex w-full items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                      Current plan
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {error && (
          <div className="mx-auto mt-6 max-w-3xl px-4 sm:px-6">
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          </div>
        )}
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold text-gray-900">Compare API tiers</h2>
            <p className="mt-2 text-gray-500">Everything you need to know before you build.</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="py-4 pl-6 pr-4 text-left font-semibold text-gray-900">Feature</th>
                  <th className="px-4 py-4 text-center font-semibold text-gray-900">Free</th>
                  <th className="px-4 py-4 text-center font-semibold text-indigo-700">Pro</th>
                  <th className="px-4 py-4 text-center font-semibold text-emerald-700">Scale</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, i) => (
                  <tr key={row.feature} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                    <td className="py-3.5 pl-6 pr-4 font-medium text-gray-700">{row.feature}</td>
                    <td className="px-4 py-3.5 text-center text-gray-600">{row.free}</td>
                    <td className="px-4 py-3.5 text-center font-medium text-indigo-600">{row.pro}</td>
                    <td className="px-4 py-4 text-center font-medium text-emerald-600">{row.scale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Built for real quota enforcement</h2>
              <p className="mt-4 text-gray-600">
                Tier changes are reflected in the API quota headers and dashboard so developers can see when they are approaching their daily limit before requests start returning `429`.
              </p>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Need more than Scale?</h2>
              <p className="mt-4 text-gray-600">
                If you need contract billing, custom limits, or merchant-grade support, we can structure an enterprise rollout separately.
              </p>
              <Link href="/contact" className="mt-4 inline-flex text-sm font-semibold text-indigo-600 hover:underline">
                Contact BuyWhere →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
