import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PartnershipInquiryForm from "@/components/partnership/PartnershipInquiryForm";

export const metadata: Metadata = {
  title: "Merchant Partnerships | BuyWhere",
  description:
    "Feature your products on BuyWhere and reach price-conscious shoppers, AI agents, and comparison experiences across Singapore and Southeast Asia.",
  alternates: {
    canonical: "https://buywhere.ai/partnership",
  },
};

const valueProps = [
  {
    stat: "3.8M+",
    label: "products indexed across priority categories",
    detail: "Merchants join a catalog already used for search, comparison, and recommendation experiences.",
  },
  {
    stat: "AI-native",
    label: "search and ranking surfaces",
    detail: "BuyWhere is designed for structured retrieval, not just storefront browsing or ad placement.",
  },
  {
    stat: "MCP-ready",
    label: "distribution into agent workflows",
    detail: "Our catalog can flow directly into AI shopping agents through API and MCP integrations.",
  },
];

const fitSignals = [
  "Featured placement for high-intent, price-sensitive categories",
  "Regional reach across Singapore and Southeast Asia buyer journeys",
  "Structured visibility inside agent recommendations and comparison flows",
  "Hands-on onboarding for catalog quality, feed shape, and commercial fit",
];

const audienceMoments = [
  {
    title: "When shoppers compare",
    text: "Surface your products where users are evaluating alternatives, prices, and merchant trust side by side.",
  },
  {
    title: "When AI agents recommend",
    text: "Be present in the structured catalog that powers product suggestions inside assistant-led buying flows.",
  },
  {
    title: "When intent is explicit",
    text: "Reach buyers already searching with category, budget, and feature constraints instead of broad awareness spend.",
  },
];

export default function PartnershipPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Nav />

      <main>
        <section className="relative overflow-hidden border-b border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.28),_transparent_28%),radial-gradient(circle_at_80%_20%,_rgba(250,204,21,0.18),_transparent_22%),linear-gradient(135deg,_#020617_0%,_#082f49_42%,_#0f172a_100%)]">
          <div className="absolute inset-0 opacity-30">
            <div className="absolute left-[-6rem] top-20 h-56 w-56 rounded-full bg-cyan-400/20 blur-3xl" />
            <div className="absolute right-[-3rem] top-10 h-64 w-64 rounded-full bg-amber-300/20 blur-3xl" />
          </div>

          <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start lg:gap-16 lg:py-24">
            <div className="max-w-2xl">
              <p className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
                Merchant partnerships
              </p>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Feature your products on BuyWhere and reach price-conscious shoppers across Singapore and Southeast Asia
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
                BuyWhere gives merchants a direct path into comparison experiences, AI-native product search, and MCP-connected agent workflows. If you want featured placement for the right categories, start here.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#partnership-form"
                  className="inline-flex items-center justify-center rounded-full bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                >
                  Start partnership inquiry
                </a>
                <Link
                  href="/about"
                  className="inline-flex items-center justify-center rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/5"
                >
                  Learn how BuyWhere works
                </Link>
              </div>

              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                {valueProps.map((item) => (
                  <div key={item.label} className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                    <div className="text-2xl font-semibold text-cyan-200">{item.stat}</div>
                    <div className="mt-2 text-sm font-medium text-white">{item.label}</div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div id="partnership-form" className="scroll-mt-24">
              <PartnershipInquiryForm />
            </div>
          </div>
        </section>

        <section className="bg-[#f5f7fb] py-16 text-slate-900">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-700">Why merchants use BuyWhere</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                Featured placement built for structured commerce discovery
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                This is not generic display inventory. We work with merchants who want to show up in moments where comparison intent is already high and the buyer is close to a decision.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {fitSignals.map((item) => (
                <div key={item} className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.35)]">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-cyan-700">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M5 12.5L9.5 17L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <p className="text-sm leading-6 text-slate-700">{item}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white py-16 text-slate-900">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-600">Where placement shows up</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                  Placement aligned to buyer intent, not broad impressions
                </h2>
              </div>
              <p className="max-w-xl text-sm leading-6 text-slate-600">
                We prioritize merchants whose products improve category depth, pricing competitiveness, and recommendation quality for developers building on BuyWhere.
              </p>
            </div>

            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {audienceMoments.map((item) => (
                <div
                  key={item.title}
                  className="rounded-[1.75rem] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff_0%,_#f8fafc_100%)] p-6 shadow-[0_30px_80px_-65px_rgba(15,23,42,0.45)]"
                >
                  <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Intent surface</div>
                  <h3 className="mt-4 text-xl font-semibold text-slate-950">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-white/10 bg-slate-950 py-16 text-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200">Next steps</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                Tell us about your catalog and target market
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                We review inquiries for category fit, market relevance, and demand-routing potential. Strong matches move into a short commercial conversation with the team.
              </p>
            </div>
            <a
              href="#partnership-form"
              className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
            >
              Submit merchant inquiry
            </a>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
