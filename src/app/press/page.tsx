import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Press Kit — BuyWhere",
  description: "Press resources, company background, logos, and media contact details for BuyWhere.",
  alternates: {
    canonical: toSiteUrl("/press/"),
  },
};

export default function PressPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      <main id="main-content" className="flex-1 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Press Kit</h1>
          <p className="text-sm text-gray-400 mb-10">Company information and media resources for BuyWhere</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Company Overview</h2>
              <p>
                BuyWhere is a product catalog API and MCP server for AI agents. Our platform gives
                developers normalized product data, prices, availability, and merchant links across
                major retailers so AI applications can recommend and compare products reliably.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Boilerplate</h2>
              <p>
                BuyWhere helps AI agents shop across the web. The company provides a unified product
                catalog API, Model Context Protocol server, and developer tools that let AI apps search,
                compare, and route users to products across retail markets. BuyWhere is operated by
                BuyWhere Pte. Ltd. in Singapore.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Media Resources</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li>Company name: BuyWhere</li>
                <li>Legal entity: BuyWhere Pte. Ltd.</li>
                <li>Headquarters: Singapore</li>
                <li>Product category: AI commerce infrastructure</li>
                <li>Primary audience: AI developers, agent builders, and commerce teams</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Media Inquiries</h2>
              <p>
                For interviews, commentary, logos, screenshots, or company background, contact{" "}
                <a href="mailto:press@buywhere.ai" className="text-indigo-600 hover:underline">
                  press@buywhere.ai
                </a>
                . Please include your publication, deadline, and the topic of your inquiry.
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
