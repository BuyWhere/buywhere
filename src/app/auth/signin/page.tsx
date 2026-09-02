import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Sign In — BuyWhere Developer Dashboard",
  description: "Sign in to BuyWhere developer dashboard to manage API keys and view usage statistics.",
  robots: { index: false, follow: false },
};

export default function AuthSigninPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Nav />
      <main id="main-content" className="flex-1 py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Sign In to Your Developer Account
            </h1>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              Please sign in to access the BuyWhere developer dashboard.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                Continue to login
              </Link>
              <Link
                href="/api-keys"
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Create a new API key
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}