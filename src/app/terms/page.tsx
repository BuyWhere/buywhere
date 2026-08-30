import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Schema from "@/components/Schema";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";
import { buildWebPageSchema } from "@/lib/page-schema";

export const metadata: Metadata = {
  title: "Terms of Service — BuyWhere",
  description: "BuyWhere Terms of Service",
  alternates: {
    canonical: toSiteUrl("/terms/"),
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Terms of Service — BuyWhere",
    description: "BuyWhere Terms of Service",
    url: toSiteUrl("/terms/"),
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "BuyWhere Terms of Service",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Terms of Service — BuyWhere",
    description: "BuyWhere Terms of Service",
    images: ["/og-image.png"],
  },
};

const termsSchema = buildWebPageSchema({
  path: "/terms/",
  name: "Terms of Service",
  description: "BuyWhere Terms of Service",
});

export default function TermsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Schema data={termsSchema} />
      <Nav />

      <main id="main-content" className="flex-1 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Terms of Service</h1>
          <p className="text-sm text-gray-400 mb-10">Last updated: 1 April 2026</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Acceptance of Terms</h2>
              <p>
                By accessing or using the BuyWhere API and website (collectively, the &quot;Service&quot;), you agree to be bound by these Terms of Service (&quot;Terms&quot;). If you do not agree to these Terms, do not use the Service. These Terms apply to all users, including developers, businesses, and any other parties who access the Service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Description of Service</h2>
              <p>
                BuyWhere provides a product catalog API designed for AI agent commerce applications, focusing on Southeast Asian markets. The Service includes access to product data, search functionality, pricing information, and related developer tools.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">3. API Usage and Quotas</h2>
              <p>
                Your use of the API is subject to the query limits associated with your subscription plan. Exceeding your plan&apos;s quota will result in requests being rejected with a 429 error code until your quota resets. BuyWhere reserves the right to throttle or suspend access in cases of abuse or violation of these Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Acceptable Use</h2>
              <p>You agree not to:</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>Use the Service for any unlawful purpose or in violation of applicable laws</li>
                <li>Resell, redistribute, or sublicense API access to third parties without written consent</li>
                <li>Attempt to reverse-engineer, scrape, or replicate the underlying data in bulk</li>
                <li>Circumvent rate limits, access controls, or authentication mechanisms</li>
                <li>Use the Service to train competing machine learning models without prior agreement</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">5. API Keys and Security</h2>
              <p>
                You are responsible for maintaining the confidentiality of your API keys. You must not share keys publicly or embed them in client-side code. Notify us immediately at security@buywhere.ai if you suspect unauthorized use of your API key.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Fees and Payment</h2>
              <p>
                Paid plan fees are billed monthly in advance. All fees are non-refundable except as required by applicable law. BuyWhere reserves the right to modify pricing with 30 days&apos; notice. Continued use of the Service after a price change constitutes acceptance of the new fees.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Data Accuracy</h2>
              <p>
                BuyWhere makes commercially reasonable efforts to provide accurate product data, pricing, and availability. However, we do not warrant that data is always accurate, complete, or up to date. Product data originates from third-party retailers and may contain errors or delays.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Intellectual Property</h2>
              <p>
                All content, data, and technology comprising the Service are the property of BuyWhere Pte. Ltd. or its licensors. These Terms do not grant you any ownership rights. You retain ownership of applications you build using the API, provided they comply with these Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by law, BuyWhere shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service. Our total liability for any claim shall not exceed the fees you paid in the three months preceding the claim.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Termination</h2>
              <p>
                BuyWhere may suspend or terminate your access to the Service at any time for violation of these Terms. You may cancel your subscription at any time through your account settings. Upon termination, your access to the API will cease immediately.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Governing Law</h2>
              <p>
                These Terms are governed by the laws of Singapore. Any disputes shall be subject to the exclusive jurisdiction of the courts of Singapore.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">12. Contact</h2>
              <p>
                For questions about these Terms, contact us via our <a href="/contact" className="text-indigo-600 hover:underline">contact page</a>.
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
