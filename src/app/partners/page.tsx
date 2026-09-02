import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import Schema from "@/components/Schema";
import PartnerIntakeForm from "@/components/PartnerIntakeForm";
import { buildWebPageSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";
export const metadata = buildPageMetadata({
  title: "Partners — Commerce Attribution & Partnerships | BuyWhere",
  description:
    "Partner with BuyWhere to solve attribution, referral, and demand routing for AI-agent commerce in Singapore.",
  path: "/partners/",
});

const partnerTypes = [
  {
    icon: "🔗",
    title: "Attribution & Referral Partners",
    desc: "Work with us on the attribution infrastructure that connects AI-agent recommendations to merchant transactions. Traditional affiliate links don't solve agent commerce attribution — we're building what does.",
  },
  {
    icon: "🏗️",
    title: "Platform & Infrastructure Partners",
    desc: "Integrate BuyWhere's product catalog into your commerce platform, AI framework, or developer toolchain. Help your users access structured product data without building their own ingestion pipeline.",
  },
  {
    icon: "📈",
    title: "Demand & Distribution Partners",
    desc: "Route qualified buyer demand to merchants through the BuyWhere catalog layer. Whether you're building shopping assistants, comparison tools, or recommendation engines — partner on demand economics.",
  },
];

export default function PartnersPage() {
  const schema = buildWebPageSchema({
    path: "/partners",
    name: "Partners — Commerce Attribution & Partnerships | BuyWhere",
    description:
      "Partner with BuyWhere to solve attribution, referral, and demand routing for AI-agent commerce in Singapore.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Partners", path: "/partners" },
    ],
  });
  return (
    <>
      <Schema data={schema} />
      <div className="flex flex-col min-h-screen">
        <Nav />

        <main id="main-content" tabIndex={-1} className="flex-1">
          {/* Hero */}
          <section className="bg-gradient-to-br from-violet-600 via-violet-700 to-violet-900 text-white py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-bold mb-4">
              Commerce partnerships for the AI agent era
            </h1>
            <p className="text-violet-200 text-lg leading-relaxed mb-8">
              AI is reshaping how consumers discover and buy products. BuyWhere is building the infrastructure
              layer — and we&rsquo;re looking for partners who want to shape how attribution, referral, and
              demand routing work in this new world.
            </p>
            <Link
              href="#apply"
              className="inline-flex items-center justify-center px-6 py-3 bg-white text-violet-700 font-semibold rounded-xl hover:bg-violet-50 transition-colors"
            >
              Explore partnerships →
            </Link>
          </div>
        </div>
      </section>

      {/* Partnership intake form (BUY-75315 — writes to contacts table via /api/v1/contact) */}
      <section id="apply" className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Propose a partnership</h2>
              <p className="text-gray-600 leading-relaxed mb-4">
                Tell us what you want to build together. We&rsquo;re early-stage and shipping fast — most partnerships go from first conversation to scoped plan within a week.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>• Attribution &amp; referral infrastructure</li>
                <li>• Platform &amp; AI framework integrations</li>
                <li>• Demand &amp; distribution routing</li>
              </ul>
            </div>
            <div>
              <PartnerIntakeForm />
            </div>
          </div>
        </div>
      </section>

      {/* The challenge */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">The attribution challenge</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              Traditional affiliate and referral models were built for a world where humans click links in browsers.
              AI agents don&rsquo;t click links. They query APIs, process structured data, and recommend products
              through conversational interfaces. The existing attribution infrastructure wasn&rsquo;t designed for this.
            </p>
            <p className="text-gray-600 leading-relaxed">
              BuyWhere is working on the commerce infrastructure that makes attribution, referral, and demand routing
              work when the buyer&rsquo;s journey starts with an AI agent instead of a search engine. This is a new
              problem, and we&rsquo;re building it with partners who understand the space.
            </p>
          </div>
        </div>
      </section>

      {/* Partner types */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-10 text-center">Partnership areas</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {partnerTypes.map((p) => (
              <div key={p.title} className="bg-white rounded-xl p-6 border border-gray-100 flex flex-col">
                <div className="text-2xl mb-3">{p.icon}</div>
                <h3 className="font-semibold text-gray-900 mb-2">{p.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed flex-1">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What we bring */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">What BuyWhere brings</h2>
            <ul className="space-y-4 text-gray-600">
              <li className="flex gap-3">
                <span className="w-1.5 h-1.5 bg-violet-500 rounded-full mt-2 shrink-0"></span>
                <span>A growing product catalog covering Singapore&rsquo;s retail market — normalized, structured, and queryable by AI agents.</span>
              </li>
              <li className="flex gap-3">
                <span className="w-1.5 h-1.5 bg-violet-500 rounded-full mt-2 shrink-0"></span>
                <span>An API layer purpose-built for agent commerce: semantic search, structured responses, and real-time data.</span>
              </li>
              <li className="flex gap-3">
                <span className="w-1.5 h-1.5 bg-violet-500 rounded-full mt-2 shrink-0"></span>
                <span>A developer community building AI shopping assistants, comparison tools, and recommendation engines on our platform.</span>
              </li>
              <li className="flex gap-3">
                <span className="w-1.5 h-1.5 bg-violet-500 rounded-full mt-2 shrink-0"></span>
                <span>A commitment to building fair, transparent commerce economics for the AI era — not extracting rents from legacy attribution models.</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-violet-600 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">Let&rsquo;s build AI commerce together</h2>
          <p className="text-violet-200 mb-8 text-lg">
            We&rsquo;re early-stage and building fast. If you&rsquo;re working on attribution,
            referral infrastructure, or AI-commerce tooling, we want to talk.
          </p>
          <Link
            href="#apply"
            className="inline-flex items-center justify-center px-8 py-3 bg-white text-violet-700 font-semibold rounded-xl hover:bg-violet-50 transition-colors"
          >
            Get in touch →
          </Link>
        </div>
      </section>

        </main>
        <Footer />
      </div>
    </>
  );
}
