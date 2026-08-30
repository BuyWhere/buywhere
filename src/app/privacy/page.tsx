import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Schema from "@/components/Schema";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";
import { buildWebPageSchema } from "@/lib/page-schema";

export const metadata: Metadata = {
  title: "Privacy Policy — BuyWhere",
  description: "BuyWhere Privacy Policy",
  alternates: {
    canonical: toSiteUrl("/privacy/"),
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Privacy Policy — BuyWhere",
    description: "BuyWhere Privacy Policy",
    url: toSiteUrl("/privacy/"),
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "BuyWhere Privacy Policy",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Privacy Policy — BuyWhere",
    description: "BuyWhere Privacy Policy",
    images: ["/og-image.png"],
  },
};

const privacySchema = buildWebPageSchema({
  path: "/privacy/",
  name: "Privacy Policy",
  description: "BuyWhere Privacy Policy",
});

export default function PrivacyPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Schema data={privacySchema} />
      <Nav />

      <main id="main-content" className="flex-1 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
          <p className="text-sm text-gray-400 mb-10">Last updated: 1 April 2026</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Introduction</h2>
              <p>
                BuyWhere Pte. Ltd. (&quot;BuyWhere&quot;, &quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to protecting your personal data. This Privacy Policy explains how we collect, use, store, and protect information when you use our website and API services. We comply with Singapore&apos;s Personal Data Protection Act 2012 (PDPA).
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>
              <p>We collect the following types of information:</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li><strong>Account information:</strong> Name, email address, and company name when you register</li>
                <li><strong>Usage data:</strong> API query logs, query content, response metadata, and access timestamps</li>
                <li><strong>Billing information:</strong> Payment method details (processed by our payment provider; we do not store card numbers)</li>
                <li><strong>Technical data:</strong> IP addresses, browser type, and device information</li>
                <li><strong>Communications:</strong> Messages you send us via contact forms or email</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">3. How We Use Your Information</h2>
              <p>We use your information to:</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>Provide, maintain, and improve the BuyWhere API and website</li>
                <li>Process payments and manage your subscription</li>
                <li>Monitor usage for quota enforcement and fraud prevention</li>
                <li>Send service-related communications (account alerts, billing notices)</li>
                <li>Provide customer support</li>
                <li>Comply with legal obligations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">4. API Query Data</h2>
              <p>
                Query content sent to our API (e.g., product search terms) may be logged for up to 90 days for debugging, abuse prevention, and service improvement. We do not use query content to identify individual users or sell it to third parties. Enterprise customers may request data processing agreements with custom retention terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Data Sharing</h2>
              <p>We do not sell your personal data. We may share data with:</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li><strong>Service providers:</strong> Payment processors, cloud hosting providers, and analytics tools that help us operate the Service</li>
                <li><strong>Legal authorities:</strong> When required by law, court order, or to protect the rights and safety of our users</li>
                <li><strong>Business transfers:</strong> In connection with a merger, acquisition, or sale of assets, with notice to you</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Data Security</h2>
              <p>
                We implement industry-standard security measures including encryption in transit (TLS), encryption at rest, access controls, and regular security reviews. API keys are hashed and never stored in plaintext. Despite these measures, no system is completely secure — please protect your API keys and notify us immediately of any suspected breach.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Data Retention</h2>
              <p>
                We retain your account data for as long as your account is active. Usage logs are retained for 90 days. Billing records are retained for 7 years as required by Singapore law. You may request deletion of your account data at any time (subject to legal retention requirements).
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Your Rights (PDPA)</h2>
              <p>Under the PDPA, you have the right to:</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>Access the personal data we hold about you</li>
                <li>Correct inaccurate personal data</li>
                <li>Withdraw consent for optional processing</li>
                <li>Request deletion of your data (subject to legal obligations)</li>
              </ul>
              <p className="mt-2">To exercise these rights, contact us via our <a href="/contact" className="text-indigo-600 hover:underline">contact page</a>.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Cookies</h2>
              <p>
                Our website uses essential cookies for authentication and session management. We do not use third-party advertising cookies. You can disable cookies in your browser settings, but this may affect functionality.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">10. International Transfers</h2>
              <p>
                Your data may be processed in countries outside Singapore where our service providers operate. We ensure such transfers comply with the PDPA&apos;s requirements for cross-border data transfers.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. We will notify registered users of material changes by email. Continued use of the Service after changes constitutes acceptance of the revised policy.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">12. Contact Us</h2>
              <p>
                For privacy inquiries or to exercise your PDPA rights, contact our Data Protection Officer via our <a href="/contact" className="text-indigo-600 hover:underline">contact page</a>.
              </p>
              <p className="mt-2">
                BuyWhere Pte. Ltd.<br />
                Singapore
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
