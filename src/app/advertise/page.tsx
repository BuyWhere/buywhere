import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Advertise — BuyWhere",
  description: "Reach AI developers and commerce teams through BuyWhere advertising and sponsorship opportunities.",
  alternates: {
    canonical: toSiteUrl("/advertise/"),
  },
};

export default function AdvertisePage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      <main id="main-content" className="flex-1 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Advertise with BuyWhere</h1>
          <p className="text-sm text-gray-400 mb-10">Reach developers and commerce teams building with AI</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Our Audience</h2>
              <p>
                BuyWhere reaches AI developers, agent builders, and commerce teams integrating product
                data into their applications. Our audience includes founders, engineers, and product
                managers actively building AI-powered shopping and comparison features.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Advertising Options</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>Developer documentation sponsorship</strong> — Feature your product or service
                  in our API documentation and quickstart guides.
                </li>
                <li>
                  <strong>API directory listing</strong> — Get listed in our public MCP server directory
                  and API marketplace.
                </li>
                <li>
                  <strong>Newsletter feature</strong> — Reach our subscriber base with a dedicated
                  feature or case study in our developer newsletter.
                </li>
                <li>
                  <strong>Custom partnerships</strong> — We&apos;re open to creative partnership ideas.
                  Reach out to discuss.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Affiliate Program</h2>
              <p>
                If you represent a retailer or brand and want to be featured in BuyWhere product results,
                our affiliate program may be a better fit. Visit our{" "}
                <Link href="/merchants" className="text-indigo-600 hover:underline">
                  merchants page
                </Link>{" "}
                to learn more.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Get in Touch</h2>
              <p>
                For advertising and partnership inquiries, contact{" "}
                <a href="mailto:ads@buywhere.ai" className="text-indigo-600 hover:underline">
                  ads@buywhere.ai
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
