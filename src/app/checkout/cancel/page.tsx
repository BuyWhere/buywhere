import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Schema from "@/components/Schema";
import { buildPageMetadata } from "@/lib/page-metadata";
import { buildWebPageSchema } from "@/lib/page-schema";

const TITLE = "Checkout cancelled | BuyWhere";
const DESCRIPTION =
  "Stripe checkout was cancelled before payment completed. Your BuyWhere developer account stays on its current plan until you restart checkout.";
const PATH = "/checkout/cancel";

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

export default function CheckoutCancelPage() {
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
            <div className="rounded-[32px] border border-amber-200 bg-white p-8 shadow-sm sm:p-10">
              <div className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
                Checkout cancelled
              </div>

              <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
                Your subscription was not changed.
              </h1>

              <p className="mt-4 text-sm leading-7 text-slate-600">
                Stripe checkout was cancelled before payment completed. Your developer account stays on its current plan until you restart checkout.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/pricing"
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                >
                  Back to pricing
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Open dashboard
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
