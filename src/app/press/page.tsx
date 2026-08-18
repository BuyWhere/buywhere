import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";

import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";
export const metadata = {
  ...buildPageMetadata({
    title: "Press — BuyWhere AI Product Catalog",
    description:
      "Press resources, media kit, and company facts for BuyWhere — building the neutral product catalog layer for AI agents in Southeast Asia.",
    path: "/press/",
  }),
  robots: {
    index: true,
    follow: true,
  },
};

export default function PressPage() {
  const schema = buildWebPageSchema({
    path: "/press",
    name: "Press — BuyWhere",
    description:
      "Press resources and media kit for BuyWhere — the AI-powered product catalog API for Southeast Asia.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Press", path: "/press" },
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
            <h1 className="text-4xl font-bold mb-4">Press & Media</h1>
            <p className="text-indigo-200 text-lg leading-relaxed">
              Resources, company facts, and contact information for journalists, analysts, and media professionals covering BuyWhere.
            </p>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">About BuyWhere</h2>
            <div className="space-y-4 text-gray-600 leading-relaxed">
              <p>
                BuyWhere is building the neutral product catalog layer for AI agents in Southeast Asia. The company provides a single API that aggregates product data from across the region&apos;s fragmented e-commerce landscape, enabling developers and AI systems to query products from multiple platforms through one unified interface.
              </p>
              <p>
                Headquartered in Singapore, BuyWhere is focused on delivering structured, high-quality product data to AI developers building shopping assistants, comparison tools, and recommendation engines. The company monetizes through referral fees and merchant partnerships rather than API subscription fees.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Company facts */}
      <section className="py-16 bg-gray-50 border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-8">Company facts</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-3xl">
            {[
              { label: "Founded", value: "2024, Singapore" },
              { label: "Headquarters", value: "Singapore" },
              { label: "Focus", value: "Southeast Asia e-commerce" },
              { label: "Product", value: "Product Catalog API for AI Agents" },
              { label: "Business model", value: "Referral fees, merchant partnerships" },
              { label: "Status", value: "Active development, developer beta" },
            ].map((fact) => (
              <div key={fact.label} className="bg-white rounded-xl p-5 border border-gray-100">
                <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">{fact.label}</div>
                <div className="font-semibold text-gray-900">{fact.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Media kit / Resources */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-8">Resources</h2>
          <div className="grid sm:grid-cols-2 gap-6 max-w-3xl">
            <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-2">Brand assets</h3>
              <p className="text-sm text-gray-500 mb-4">
                Logo, color palette, and brand guidelines are available on request.
              </p>
              <Link href="/contact" className="text-sm text-indigo-600 hover:underline font-medium">
                Request brand assets →
              </Link>
            </div>
            <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-2">API documentation</h3>
              <p className="text-sm text-gray-500 mb-4">
                Technical documentation, API reference, and integration guides for developers.
              </p>
              <Link href="/docs" className="text-sm text-indigo-600 hover:underline font-medium">
                View docs →
              </Link>
            </div>
            <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-2">Blog & changelog</h3>
              <p className="text-sm text-gray-500 mb-4">
                Latest updates, product news, and engineering posts from the BuyWhere team.
              </p>
              <Link href="/blog" className="text-sm text-indigo-600 hover:underline font-medium">
                Read blog →
              </Link>
            </div>
            <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-2">About page</h3>
              <p className="text-sm text-gray-500 mb-4">
                Company mission, values, and the problem we&apos;re solving.
              </p>
              <Link href="/about" className="text-sm text-indigo-600 hover:underline font-medium">
                Learn more →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-16 bg-indigo-50 border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Media contact</h2>
          <div className="max-w-xl">
            <p className="text-gray-600 mb-6 leading-relaxed">
              For press inquiries, interview requests, or media information, please reach out through our contact page or email us directly.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/contact"
                className="inline-flex items-center justify-center px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors text-sm"
              >
                Contact us →
              </Link>
              <Link
                href="mailto:press@buywhere.ai"
                className="inline-flex items-center justify-center px-5 py-2.5 border border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-colors text-sm"
              >
                press@buywhere.ai
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="py-12 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <p className="text-xs text-gray-400">
            BuyWhere is an independent company and is not affiliated with, endorsed by, or connected to Shopee, Lazada, or any other e-commerce platform mentioned on this site. All product names, logos, and brands are property of their respective owners.
          </p>
        </div>
      </section>

      </main>
      <Footer />
    </div>
    </>
  );
}
