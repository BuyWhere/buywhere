import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";

import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";
export const metadata = {
  ...buildPageMetadata({
    title: "Join BuyWhere — Build the AI Commerce Infrastructure for Southeast Asia",
    description:
      "BuyWhere is hiring engineers, data specialists, and developer advocates. Help us build the neutral product catalog layer for AI agents.",
    path: "/careers/",
  }),
  robots: {
    index: true,
    follow: true,
  },
};

export default function CareersPage() {
  const schema = buildWebPageSchema({
    path: "/careers",
    name: "Join BuyWhere — AI Commerce Infrastructure Careers",
    description:
      "Open roles at BuyWhere — building the neutral product catalog layer for AI agents in Southeast Asia.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Careers", path: "/careers" },
    ],
  });
  return (
    <>
      <Schema data={schema} />
      <div className="flex flex-col min-h-screen">
        <Nav />

      <main id="main-content">
      {/* Hero */}
      <section className="bg-indigo-600 text-white py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-bold mb-4">Work on problems that matter</h1>
            <p className="text-indigo-200 text-lg leading-relaxed">
              BuyWhere is building the product catalog layer for AI agents in Southeast Asia. We&apos;re a small, focused team looking for people who want to shape how AI-powered commerce works in one of the world&apos;s most dynamic e-commerce markets.
            </p>
          </div>
        </div>
      </section>

      {/* Why BuyWhere */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Why BuyWhere</h2>
            <div className="space-y-4 text-gray-600 leading-relaxed">
              <p>
                Southeast Asia&apos;s e-commerce market is fragmented across a dozen platforms, each with its own API, its own catalog, and its own incentive to surface its own products. AI agents need to see the whole market to give good recommendations — and right now, that&apos;s nearly impossible.
              </p>
              <p>
                BuyWhere solves that. We&apos;re building a neutral, product-first catalog API that aggregates across Singapore&apos;s retail landscape and exposes it in a clean, structured format. Developers can query one API and get results from the whole market. AI agents can reason across products without being pushed toward any particular platform.
              </p>
              <p>
                We&apos;re at the ground floor of what we believe will become core commerce infrastructure. The work is technically interesting, the market is underserved, and the team is small enough that your contributions will be visible and consequential from day one.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Open roles */}
      <section className="py-16 bg-gray-50 border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-8">Open roles</h2>
          <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
            {[
              {
                title: "Senior Backend Engineer",
                location: "Singapore / Remote",
                type: "Full-time",
                desc: "Design and build the catalog ingestion and API layer. You&apos;ll work on data pipelines, API design, and scaling to millions of products.",
              },
              {
                title: "Data Engineer",
                location: "Singapore / Remote",
                type: "Full-time",
                desc: "Build and maintain the product data pipeline. You&apos;ll tackle normalization, deduplication, and schema mapping across diverse merchant feeds.",
              },
              {
                title: "Developer Advocate",
                location: "Singapore / Remote",
                type: "Full-time",
                desc: "Help developers get the most out of the BuyWhere API. You&apos;ll write docs, build examples, and engage with the AI agent developer community.",
              },
            ].map((role) => (
              <div key={role.title} className="bg-white rounded-xl p-6 border border-gray-100">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-gray-900 text-sm">{role.title}</h3>
                  <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">
                    {role.type}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mb-3">{role.location}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{role.desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-gray-500">
            Don&apos;t see a perfect match? We&apos;re always interested in exceptional people.{" "}
            <Link href="/contact" className="text-indigo-600 hover:underline font-medium">
              Get in touch
            </Link>{" "}
            and tell us how you&apos;d like to contribute.
          </p>
        </div>
      </section>

      {/* Values */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-8">How we work</h2>
          <div className="grid sm:grid-cols-2 gap-6 max-w-3xl">
            {[
              { title: "Small teams, big ownership", desc: "No large teams or process for process&apos;s sake. We keep things small so everyone has real ownership and real impact." },
              { title: "Agent-first mindset", desc: "We&apos;re building for AI agents as a primary user — not as an afterthought. If you care about developer experience and structured data, you&apos;ll feel at home." },
              { title: "Ship and learn", desc: "We move quickly, gather real-world feedback, and iterate. The product changes weekly. If you like stable requirements, this isn&apos;t the right role." },
              { title: "Southeast Asia first", desc: "We&apos;re focused on Singapore and the region. We care deeply about the local market, the local developer community, and the local commerce ecosystem." },
            ].map((v) => (
              <div key={v.title} className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                <h3 className="font-semibold text-gray-900 text-sm mb-2">{v.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-indigo-600 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to build with us?</h2>
          <p className="text-indigo-200 mb-8 max-w-xl mx-auto">
            Reach out even if your experience doesn&apos;t perfectly match a listed role. We&apos;re looking for curious, capable people who want to work on genuinely new infrastructure.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/contact"
              className="inline-flex items-center justify-center px-6 py-3 bg-white text-indigo-700 font-semibold rounded-xl hover:bg-indigo-50 transition-colors text-sm"
            >
              Get in touch →
            </Link>
            <Link
              href="/about"
              className="inline-flex items-center justify-center px-6 py-3 border border-indigo-400 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors text-sm"
            >
              Learn about BuyWhere
            </Link>
          </div>
        </div>
      </section>

      </main>
      <Footer />
    </div>
    </>
  );
}
