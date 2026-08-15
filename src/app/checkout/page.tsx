import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { toSiteUrl } from "@/lib/site-url";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import CheckoutClient from "./CheckoutClient";

const CHECKOUT_DESCRIPTION =
  "Confirm your BuyWhere Pro or Scale plan, then continue to Stripe checkout with the developer account tied to your API key.";

export const metadata: Metadata = {
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
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "BuyWhere Stripe Checkout",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stripe Checkout | BuyWhere",
    description: CHECKOUT_DESCRIPTION,
    images: ["/og-image.png"],
  },
};

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

export default function CheckoutPage() {
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

              <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
                Complete checkout.
              </h1>

              <p className="mt-4 text-sm leading-7 text-slate-600">
                Review your selected plan, then continue to Stripe to activate your subscription on the same developer account.
              </p>

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
