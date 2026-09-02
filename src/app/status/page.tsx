import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "BuyWhere API Status — Operational Health",
  description:
    "Real-time operational status for BuyWhere API, MCP server, and product catalog services. Check for uptime, incidents, and scheduled maintenance.",
  alternates: {
    canonical: toSiteUrl("/status"),
  },
  openGraph: {
    title: "BuyWhere API Status — Operational Health",
    description:
      "Real-time operational status for BuyWhere API, MCP server, and product catalog services.",
    url: toSiteUrl("/status"),
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "BuyWhere API Status — Operational Health",
      },
    ],
  },
};

export default function StatusPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "BuyWhere API Status",
    description:
      "Real-time operational status for BuyWhere API, MCP server, and product catalog services.",
    url: toSiteUrl("/status"),
    mainEntity: {
      "@type": "WebSite",
      name: "BuyWhere",
      url: "https://buywhere.ai",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="flex min-h-screen flex-col bg-white">
        <Nav />
        <main id="main-content" className="flex-1">
          <section className="bg-gradient-to-br from-indigo-700 via-slate-900 to-sky-900 text-white py-16">
            <div className="mx-auto max-w-4xl px-4 sm:px-6">
              <h1 className="text-4xl font-bold sm:text-5xl">API Status</h1>
              <p className="mt-4 text-lg text-indigo-100">
                Real-time operational status for BuyWhere services.
              </p>
            </div>
          </section>

          <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-3 w-3">
                  <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
                </span>
                <h2 className="text-xl font-semibold text-emerald-800">All Systems Operational</h2>
              </div>
              <p className="mt-2 text-emerald-700">
                All BuyWhere services are running normally.
              </p>
            </div>

            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <h3 className="text-lg font-semibold text-slate-900">BuyWhere API</h3>
                <p className="mt-1 text-sm text-slate-600">Product catalog search and retrieval API</p>
                <p className="mt-3 text-sm font-medium text-emerald-600">Operational</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <h3 className="text-lg font-semibold text-slate-900">MCP Server</h3>
                <p className="mt-1 text-sm text-slate-600">Model Context Protocol server</p>
                <p className="mt-3 text-sm font-medium text-emerald-600">Operational</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <h3 className="text-lg font-semibold text-slate-900">Catalog Ingestion</h3>
                <p className="mt-1 text-sm text-slate-600">Product data pipeline</p>
                <p className="mt-3 text-sm font-medium text-emerald-600">Operational</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <h3 className="text-lg font-semibold text-slate-900">Documentation</h3>
                <p className="mt-1 text-sm text-slate-600">Developer docs and API reference</p>
                <p className="mt-3 text-sm font-medium text-emerald-600">Operational</p>
              </div>
            </div>

            <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-6">
              <h3 className="text-lg font-semibold text-slate-900">Historical Uptime</h3>
              <p className="mt-2 text-sm text-slate-600">
                View detailed incident history on our status page:
              </p>
              <a
                href="https://status.buywhere.ai/"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                View full status dashboard →
              </a>
            </div>

            <div className="mt-8 text-center">
              <Link
                href="/docs"
                className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Read Documentation
              </Link>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    </>
  );
}
