import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "For Business — BuyWhere",
  description: "Partner with BuyWhere as a retailer, brand, or technology partner. Integrate your products into the BuyWhere API and MCP catalog.",
  alternates: {
    canonical: toSiteUrl("/for-business/"),
  },
};

export default function ForBusinessPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      <main id="main-content" className="flex-1 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">For Business</h1>
          <p className="text-sm text-gray-400 mb-10">Partner with BuyWhere as a retailer, brand, or technology provider</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Retailers & Brands</h2>
              <p>
                Get your products in front of AI agents and developers building commerce applications.
                BuyWhere aggregates product data across retailers, giving you visibility in the growing
                AI-first shopping market.
              </p>
              <ul className="list-disc pl-5 space-y-2 mt-3">
                <li>Product data feed integration — share your catalog via our standard feed format</li>
                <li>Affiliate partnerships — earn referral traffic when users buy through our links</li>
                <li>Developer-facing product placement in API search results</li>
              </ul>
              <p className="mt-3">
                Learn more on our{" "}
                <Link href="/merchants" className="text-indigo-600 hover:underline">
                  merchants page
                </Link>
                .
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Technology Partners</h2>
              <p>
                Integrate BuyWhere into your platform, framework, or marketplace. We offer MCP server
                support, webhook-based data delivery, and custom API arrangements for platform partners.
              </p>
              <ul className="list-disc pl-5 space-y-2 mt-3">
                <li>MCP server marketplace listing — get listed at buywhere.ai/mcp</li>
                <li>Custom data delivery via webhooks or bulk export</li>
                <li>Co-marketing opportunities for integration partners</li>
              </ul>
              <p className="mt-3">
                Visit our{" "}
                <Link href="/partners" className="text-indigo-600 hover:underline">
                  partners page
                </Link>{" "}
                for details.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Enterprise</h2>
              <p>
                For larger-scale or custom arrangements, including white-label integrations, dedicated
                API tiers, or SLA-backed service agreements, reach out to discuss your requirements.
              </p>
              <p className="mt-3">
                Contact{" "}
                <a href="mailto:partnerships@buywhere.ai" className="text-indigo-600 hover:underline">
                  partnerships@buywhere.ai
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
