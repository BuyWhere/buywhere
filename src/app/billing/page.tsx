import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

const BILLING_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Billing & Subscription Management | BuyWhere",
  description:
    "Manage your BuyWhere billing, subscription, and payment settings. View invoices, update payment methods, and control your plan tier.",
  url: toSiteUrl("/billing"),
  publisher: {
    "@type": "Organization",
    name: "BuyWhere",
    url: "https://buywhere.ai",
  },
  mainEntity: {
    "@type": "Thing",
    name: "BuyWhere Billing",
    description: "Subscription and billing management for BuyWhere API services.",
  },
  breadcrumb: {
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://buywhere.ai/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Billing",
        item: "https://buywhere.ai/billing",
      },
    ],
  },
};

export const metadata: Metadata = {
  title: "Billing & Subscription Management | BuyWhere",
  description:
    "Manage your BuyWhere billing, subscription, and payment settings. View invoices, update payment methods, and control your plan tier.",
  alternates: {
    canonical: toSiteUrl("/billing"),
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Billing & Subscription Management | BuyWhere",
    description:
      "Manage your BuyWhere billing, subscription, and payment settings. View invoices, update payment methods, and control your plan tier.",
    url: toSiteUrl("/billing"),
    type: "website",
    siteName: "BuyWhere",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "BuyWhere Billing & Subscription Management",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Billing & Subscription Management | BuyWhere",
    description:
      "Manage your BuyWhere billing, subscription, and payment settings. View invoices, update payment methods, and control your plan tier.",
    images: ["/og-image.png"],
  },
};

export default function BillingPage({
  searchParams,
}: {
  searchParams?: { cancelled?: string };
}) {
  const cancelled = searchParams?.cancelled === "true";

  if (cancelled) {
    redirect("/checkout/cancel");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(BILLING_JSON_LD) }}
      />

      <main id="main-content" tabIndex={-1} className="flex-1">
        <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
            <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
              cancelled
                ? "bg-amber-50 text-amber-700"
                : "bg-indigo-50 text-indigo-700"
            }`}>
              {cancelled ? "Checkout cancelled" : "Billing"}
            </div>

            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
              {cancelled
                ? "Your Stripe checkout was cancelled before the plan changed."
                : "Manage your BuyWhere billing path."}
            </h1>

            <p className="mt-4 text-sm leading-7 text-slate-600">
              {cancelled
                ? "Your API key stays on its current tier. You can restart checkout from pricing or from the API key dashboard whenever you are ready."
                : "Use pricing to compare self-serve plans, then return to the dashboard to verify the updated quota after checkout completes."}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                View pricing
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
        </section>
      </main>

      <Footer />
    </div>
  );
}
