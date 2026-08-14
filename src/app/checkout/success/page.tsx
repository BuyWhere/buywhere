import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Schema from "@/components/Schema";
import CheckoutSuccessClient from "./CheckoutSuccessClient";
import { buildPageMetadata } from "@/lib/page-metadata";
import { buildWebPageSchema } from "@/lib/page-schema";

const TITLE = "Checkout complete — thank you | BuyWhere";
const DESCRIPTION =
  "Your BuyWhere checkout completed successfully. Review your activated subscription and request quota, then open the developer dashboard.";
const PATH = "/checkout/success";

// Server-rendered metadata so /checkout/success no longer inherits the homepage
// title and emits a real og:image + canonical. BUY-68919 AC #4/#5.
export const metadata: Metadata = {
  ...buildPageMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
  }),
  robots: {
    index: false,
    follow: true,
  },
};

export default function CheckoutSuccessPage() {
  const schema = buildWebPageSchema({
    path: PATH,
    name: TITLE,
    description: DESCRIPTION,
  });

  return (
    <>
      <Schema data={schema} />
      <div className="flex min-h-screen flex-col bg-slate-50">
        <Nav />

        <main id="main-content" tabIndex={-1} className="flex-1 py-16">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            {/* Static SSR confirmation block — always present in HTML so crawlers
                and no-JS clients see the success H1 + copy (BUY-68919 AC #1). */}
            <div className="rounded-[32px] border border-emerald-200 bg-white p-8 shadow-sm sm:p-10">
              <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                Subscription activated
              </div>

              <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
                Your checkout completed successfully.
              </h1>

              <p className="mt-4 text-sm leading-7 text-slate-600">
                Your BuyWhere account has been sent through Stripe checkout. We’re reading back the live
                subscription state below.
              </p>

              {/* Dynamic subscription read-back is client-only (reads localStorage + a
                  fetch). Suspense-fallback keeps a meaningful confirmation visible in SSR. */}
              <Suspense
                fallback={
                  <div className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-6">
                    <p className="text-sm text-slate-600">Loading subscription details...</p>
                  </div>
                }
              >
                <CheckoutSuccessClient />
              </Suspense>

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
        </main>

        <Footer />
      </div>
    </>
  );
}
