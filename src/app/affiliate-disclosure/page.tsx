import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Affiliate Disclosure — BuyWhere",
  description: "BuyWhere Affiliate Disclosure Policy",
  alternates: {
    canonical: "/affiliate-disclosure",
  },
};

export default function AffiliateDisclosurePage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      <main id="main-content" className="flex-1 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Affiliate Disclosure</h1>
          <p className="text-sm text-gray-400 mb-10">Last updated: 17 May 2026</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Overview</h2>
              <p>
                BuyWhere Pte. Ltd. (&quot;BuyWhere,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is a product catalog API 
                provider for AI agent commerce applications. This Affiliate Disclosure explains how we 
                may earn commissions when you purchase products through affiliate links on our website 
                or through our API services.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">FTC Compliance</h2>
              <p>
                In accordance with the Federal Trade Commission&apos;s guidelines on endorsements and testimonials, 
                we make the following disclosures:
              </p>
              <ul className="list-disc pl-5 space-y-2 mt-2">
                <li>
                  <strong>Affiliate Relationships:</strong> BuyWhere may participate in affiliate programs with 
                  various retailers and merchants. When you click on product links on our website or API 
                  and make a purchase, we may earn a commission from qualifying purchases.
                </li>
                <li>
                  <strong>Editorial Independence:</strong> Our editorial content is not influenced by affiliate 
                  partnerships. We strive to provide accurate, unbiased product information regardless of 
                  any affiliate relationships.
                </li>
                <li>
                  <strong>Not Financial Advice:</strong> The information provided through BuyWhere should not be 
                  construed as financial, investment, or purchasing advice. Any purchasing decisions are made 
                  at your own discretion.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Singapore Regulatory Compliance</h2>
              <p>
                For users in Singapore, this disclosure is provided in compliance with applicable consumer 
                protection laws, including the Consumer Protection (Fair Trading) Act (Cap. 52A) and the 
                Personal Data Protection Act 2012 (PDPA):
              </p>
              <ul className="list-disc pl-5 space-y-2 mt-2">
                <li>
                  <strong>Transparent Disclosure:</strong> We clearly disclose affiliate relationships to help 
                  you make informed purchasing decisions.
                </li>
                <li>
                  <strong>Data Handling:</strong> Any personal data collected in connection with affiliate 
                  referrals is handled in accordance with our Privacy Policy and the PDPA.
                </li>
                <li>
                  <strong>Right to Information:</strong> You have the right to request information about our 
                  affiliate relationships upon request.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">How Affiliate Links Work</h2>
              <p>
                When you use BuyWhere&apos;s product search or comparison services, affiliate links may be 
                generated that direct you to retailer websites. If you subsequently purchase a product 
                from those retailers, we may receive a commission at no additional cost to you. This 
                commission helps support the continued operation of BuyWhere&apos;s services.
              </p>
              <p className="mt-3">
                The commission rates vary by retailer and product category. Specific commission details 
                are maintained in our internal records and are available upon legitimate request from 
                authorized regulatory bodies.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Short Disclosure Notice</h2>
              <p>
                For your convenience, a short disclosure notice appears on pages displaying affiliate-linked 
                products and near purchase buttons. The short disclosure reads: 
              </p>
              <div className="mt-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800">
                  <strong>For US Users:</strong> We may earn a commission if you purchase via our links.
                </p>
                <p className="text-sm text-amber-800 mt-2">
                  <strong>For SG/MY Users:</strong> We may earn a commission if you purchase via our affiliate links.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Contact Us</h2>
              <p>
                If you have any questions about this Affiliate Disclosure or our affiliate relationships, 
                please contact us at:
              </p>
              <ul className="list-none mt-3 space-y-1">
                <li>
                  <strong>Email:</strong>{" "}
                  <a href="mailto:legal@buywhere.ai" className="text-indigo-600 hover:underline">
                    legal@buywhere.ai
                  </a>
                </li>
                <li>
                  <strong>Address:</strong> BuyWhere Pte. Ltd., Singapore
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Updates to This Disclosure</h2>
              <p>
                We may update this Affiliate Disclosure from time to time to reflect changes in our 
                affiliate relationships or regulatory requirements. Any updates will be posted on this 
                page with a revised &quot;Last updated&quot; date. Continued use of our services after any 
                modifications constitutes acceptance of the updated disclosure.
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
