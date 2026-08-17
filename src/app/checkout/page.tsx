import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { toSiteUrl } from "@/lib/site-url";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import CheckoutClient from "./CheckoutClient";
const CHECKOUT_DESCRIPTION =
  "Confirm your BuyWhere Pro or Scale plan, then continue to Stripe checkout with the developer account tied to your API key.";

// BUY-68508: Plan-specific pricing for SSR shell
const PLAN_PRICING: Record<string, { price: string; label: string; annualPrice: string }> = {
  starter: { price: "$9 / month", label: "Starter", annualPrice: "$89 / year (save 18%)" },
  pro: { price: "$29 / month", label: "Pro", annualPrice: "$290 / year (save 18%)" },
  scale: { price: "$99 / month", label: "Scale", annualPrice: "$990 / year (save 18%)" },
};

// Returns the raw lowercased plan key for PLAN_PRICING lookup.
// Unlike canonicalizeBillingTier this does NOT alias starter→pro, so the
// SSR title/badging correctly shows the plan the user selected.
function getCheckoutPlanKey(planParam: string | undefined) {
  return planParam?.toLowerCase() ?? "";
}

function metadataFromSearchParams(searchParams: Record<string, string | string[] | undefined>): Metadata {
  const planParam = Array.isArray(searchParams.plan) ? searchParams.plan[0] : searchParams.plan;
  const billingParam = Array.isArray(searchParams.billing) ? searchParams.billing[0] : searchParams.billing;

  const plan = getCheckoutPlanKey(planParam);
  const isAnnual = billingParam === "annual";
  const pricing = PLAN_PRICING[plan];

  // Unsupported plan: render recovery metadata
  if (plan && !pricing) {
    return {
      title: "Checkout plan unavailable | BuyWhere",
      description: "The selected checkout plan is not available. Choose Starter, Pro, or Scale from pricing.",
      alternates: {
        canonical: toSiteUrl("/checkout"),
      },
      robots: {
        index: false,
        follow: true,
      },
      openGraph: {
        title: "Checkout plan unavailable | BuyWhere",
        description: "The selected checkout plan is not available. Choose Starter, Pro, or Scale from pricing.",
        url: toSiteUrl("/checkout"),
        type: "website",
        siteName: "BuyWhere",
        images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "BuyWhere Checkout" }],
      },
      twitter: {
        card: "summary_large_image",
        title: "Checkout plan unavailable | BuyWhere",
        description: "The selected checkout plan is not available. Choose Starter, Pro, or Scale from pricing.",
        images: ["/og-image.png"],
      },
    };
  }

  // Plan-specific metadata
  if (plan && pricing) {
    const planLabel = pricing.label;
    const title = `${planLabel} (${isAnnual ? "annual" : "monthly"}) Checkout | BuyWhere`;
    const description = `Subscribe to BuyWhere ${planLabel} plan at ${isAnnual ? pricing.annualPrice : pricing.price}. Continue to Stripe checkout.`;

    return {
      title,
      description,
      alternates: {
        canonical: toSiteUrl("/checkout"),
      },
      robots: {
        index: false,
        follow: true,
      },
      openGraph: {
        title,
        description,
        url: toSiteUrl(`/checkout?plan=${plan}${isAnnual ? "&billing=annual" : ""}`),
        type: "website",
        siteName: "BuyWhere",
        images: [{ url: "/og-image.png", width: 1200, height: 630, alt: `BuyWhere ${planLabel} Checkout` }],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: ["/og-image.png"],
      },
    };
  }

  // Default checkout metadata (no plan selected)
  return {
    title: "Stripe Checkout | BuyWhere",
    description: CHECKOUT_DESCRIPTION,
    alternates: {
      canonical: toSiteUrl("/checkout"),
    },
    robots: {
      index: false,
      follow: true,
    },
    openGraph: {
      title: "Stripe Checkout | BuyWhere",
      description: CHECKOUT_DESCRIPTION,
      url: toSiteUrl("/checkout"),
      type: "website",
      siteName: "BuyWhere",
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "BuyWhere Stripe Checkout" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Stripe Checkout | BuyWhere",
      description: CHECKOUT_DESCRIPTION,
      images: ["/og-image.png"],
    },
  };
}

export function generateMetadata({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}): Metadata {
  return metadataFromSearchParams(searchParams ?? {});
}

// BUY-70191: SSR scaffold for a11y/SEO. Renders H1 and explanatory copy
// server-side before hydration so screen readers and no-JS users have an
// actionable path. Client component handles plan selection and Stripe redirect.
function CheckoutLoadingSkeleton() {
  return (
    <div className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-6" role="status" aria-live="polite">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
        Loading checkout options
      </p>
      <p className="mt-3 text-sm leading-7 text-slate-600">
        We&apos;re preparing the Stripe checkout controls for this browser session.
      </p>
      <Link
        href="/pricing"
        className="mt-5 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
      >
        Back to pricing
      </Link>
    </div>
  );
}

export default function CheckoutPage({
  searchParams,
}: {
  searchParams?: { plan?: string; billing?: string };
}) {
  const planParam = searchParams?.plan;
  const billingParam = searchParams?.billing;
  const plan = getCheckoutPlanKey(planParam);
  const isAnnual = billingParam === "annual";
  const pricing = PLAN_PRICING[plan];
  const isUnsupportedPlan = planParam && !pricing;

  // BUY-68508: SSR shell shows selected plan details when available
  const showPlanShell = plan && pricing;
  const showRecovery = isUnsupportedPlan;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Nav />

      <main id="main-content" tabIndex={-1} className="flex-1">
        <section className="py-16">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
              <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">
                Stripe checkout
              </div>

              {showRecovery ? (
                // Unsupported plan: render recovery shell
                <>
                  <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
                    Checkout plan unavailable.
                  </h1>
                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    The plan &quot;{planParam}&quot; is not available. Choose Starter, Pro, or Scale from our pricing page.
                  </p>
                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Link
                      href="/pricing"
                      className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                    >
                      View pricing
                    </Link>
                  </div>
                </>
              ) : showPlanShell ? (
                // Plan-specific shell with pricing
                <>
                  <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
                    Complete checkout.
                  </h1>
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="inline-flex rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                          {pricing.label}
                        </div>
                        <div className="mt-3 text-2xl font-semibold text-slate-900">
                          {isAnnual ? pricing.annualPrice : pricing.price}
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                          {isAnnual ? "billed annually" : "billed monthly"}
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    Review your selected plan, then continue to Stripe to activate your subscription on the same developer account.
                  </p>
                </>
              ) : (
                // Default shell
                <>
                  <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
                    Complete checkout.
                  </h1>
                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    Review your selected plan, then continue to Stripe to activate your subscription on the same developer account.
                  </p>
                </>
              )}

              {/* BUY-70191: Suspense boundary allows SSR to render H1/copy first,
                  then hydrates the interactive client component. */}
              <Suspense fallback={<CheckoutLoadingSkeleton />}>
                <CheckoutClient />
              </Suspense>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
