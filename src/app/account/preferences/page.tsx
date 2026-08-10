import { Suspense } from "react";
import type { Metadata } from "next";

import { buildPageMetadata } from "@/lib/page-metadata";
import AlertPreferencesClient from "./AlertPreferencesClient";

export const metadata: Metadata = {
  ...buildPageMetadata({
    title: "Alert Preferences — Manage Price Alert Email Settings | BuyWhere",
    description:
      "Control which price alerts reach your inbox. Unsubscribe from individual alerts or pause alerts entirely in your BuyWhere account preferences.",
    path: "/account/preferences",
  }),
  robots: {
    index: false,
    follow: true,
  },
};

function PreferencesFallback() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-950">
      <main id="main-content" className="flex-1 bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.12),_transparent_34%),linear-gradient(180deg,#f8fafc_0%,#ffffff_40%,#eef2ff_100%)]">
        <section className="border-b border-slate-200 bg-slate-950 text-white">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-100">
                Email preferences
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                Control which price alerts reach your inbox.
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-300 sm:text-base">
                Alert preferences are loading. You can unsubscribe from a single alert or manage active price watches from this page.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function AlertPreferencesPage() {
  return (
    <Suspense fallback={<PreferencesFallback />}>
      <AlertPreferencesClient />
    </Suspense>
  );
}
