import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Careers — Join BuyWhere",
  description: "Join BuyWhere and help us build the product catalog API for AI agents. We're hiring engineers, product managers, and more.",
  alternates: {
    canonical: toSiteUrl("/careers/"),
  },
};

export default function CareersPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      <main id="main-content" className="flex-1 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Join BuyWhere</h1>
          <p className="text-sm text-gray-400 mb-10">Build the future of AI-powered commerce</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">About BuyWhere</h2>
              <p>
                BuyWhere is building the product catalog API that powers AI agents to help consumers find and
                purchase products across retail. We aggregate product data from thousands of retailers into
                a unified, AI-friendly API — enabling agents to search, compare, and recommend products
                with accurate, real-time data.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Why Join Us</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Remote-first culture</strong> — Work from anywhere in UTC-8 to UTC+8</li>
                <li><strong>Competitive equity</strong> — Meaningful ownership in a growing startup</li>
                <li><strong>Learning opportunities</strong> — Work with cutting-edge AI/ML technologies</li>
                <li><strong>Flexible hours</strong> — Async-first collaboration</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Open Positions</h2>

              <div className="space-y-4">
                <div className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900">Senior Backend Engineer</h3>
                  <p className="text-gray-600 text-sm mt-1">Full-time · Remote (UTC-8 to UTC+8)</p>
                  <p className="text-gray-600 text-sm mt-2">
                    Build scalable APIs and data pipelines. Experience with Python, PostgreSQL, and
                    distributed systems required.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900">Full-Stack Engineer</h3>
                  <p className="text-gray-600 text-sm mt-1">Full-time · Remote (UTC-8 to UTC+8)</p>
                  <p className="text-gray-600 text-sm mt-2">
                    Work on our Next.js web app and API. Experience with React, TypeScript,
                    and Node.js required.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900">Data Engineer</h3>
                  <p className="text-gray-600 text-sm mt-1">Full-time · Remote (UTC-8 to UTC+8)</p>
                  <p className="text-gray-600 text-sm mt-2">
                    Build and maintain data pipelines for product aggregation. Experience with
                    ETL, data modeling, and Python required.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">How to Apply</h2>
              <p>
                Send your resume and a brief intro to{" "}
                <a href="mailto:careers@buywhere.ai" className="text-indigo-600 hover:underline">
                  careers@buywhere.ai
                </a>
                . We review applications on a rolling basis and typically respond within one week.
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
