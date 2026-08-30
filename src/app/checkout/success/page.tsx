import { Suspense } from "react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import CheckoutSuccessClient from "@/components/CheckoutSuccessClient";

export default function CheckoutSuccessPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Nav />

      <section id="main-content" className="flex-1 py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="rounded-[32px] border border-emerald-200 bg-white p-8 shadow-sm sm:p-10">
            <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              Subscription activated
            </div>

            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
              Your checkout completed successfully.
            </h1>

            <p className="mt-4 text-sm leading-7 text-slate-600">
              Your BuyWhere account has been sent through Stripe checkout. We&apos;re reading back the live subscription
              state below.
            </p>

            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              No Stripe session ID was present in the URL. You can still open the dashboard to verify your current plan.
            </div>

            <Suspense fallback={null}>
              <CheckoutSuccessClient />
            </Suspense>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
