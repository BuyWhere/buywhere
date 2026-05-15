import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Contact — BuyWhere",
  description: "Get in touch with BuyWhere. Request API access, ask questions, or discuss your use case.",
  alternates: {
    canonical: toSiteUrl("/contact/"),
  },
};

export default function ContactPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      {/* Header */}
      <section className="bg-indigo-600 text-white py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold mb-3">Get in touch</h1>
          <p className="text-indigo-200 text-lg">
            Request API access, ask a question, or talk to us about your use case.
          </p>
        </div>
      </section>

      <section className="py-16 bg-white flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid md:grid-cols-2 gap-12">

            {/* Form */}
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-6">Send us a message</h2>
              <form className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
                    <input
                      type="text"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="Jane"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
                    <input
                      type="text"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="Smith"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Work email</label>
                  <input
                    type="email"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="jane@company.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">What are you building?</label>
                  <select className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-700">
                    <option value="">Select a use case...</option>
                    <option>AI shopping assistant</option>
                    <option>Price comparison tool</option>
                    <option>Affiliate recommendation engine</option>
                    <option>E-commerce analytics</option>
                    <option>Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                  <textarea
                    rows={4}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                    placeholder="Tell us about your project, expected query volume, or any questions..."
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 transition-colors"
                >
                  Send message →
                </button>

                <p className="text-xs text-gray-400 text-center">
                  We respond to all inquiries within 1 business day.
                </p>
              </form>
            </div>

            {/* Info */}
            <div className="space-y-8">
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-4">Why reach out?</h2>
                <ul className="space-y-3 text-sm text-gray-600">
                  {[
                    "Get your API key immediately (free tier)",
                    "Trial access for Growth or Scale plans",
                    "Technical questions before integrating",
                    "Enterprise pricing and SLA discussions",
                    "Partnership and affiliate inquiries",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-gray-50 rounded-xl p-6 space-y-4">
                <h3 className="font-semibold text-gray-900">Get in touch directly</h3>
                <div className="space-y-3 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <span className="text-indigo-500">✉</span>
                    <span>hello@buywhere.ai</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-indigo-500">🏢</span>
                    <span>Singapore, Republic of Singapore</span>
                  </div>
                </div>
              </div>

              <div className="bg-indigo-50 rounded-xl p-6">
                <h3 className="font-semibold text-gray-900 mb-2">Developer beta</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  We&apos;re in active developer beta. API keys are issued within minutes during business hours. Join now to help shape the product.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
