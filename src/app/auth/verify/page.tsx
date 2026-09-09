import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Verify Authentication — BuyWhere",
  description: "Verify your authentication for BuyWhere developer dashboard.",
  robots: { index: false, follow: false },
};

export default function AuthVerifyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Nav />
      <main id="main-content" className="flex-1 py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Verify Your Authentication
            </h1>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              Verifying your authentication session. Please wait while we confirm your access.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                Go to dashboard
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Sign in again
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}