import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import ContactForm from "@/components/ContactForm";
import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";
export const metadata = buildPageMetadata({
  title: "Contact — BuyWhere",
  description:
    "Get in touch with BuyWhere. Request API access, ask questions, or discuss your use case.",
  path: "/contact/",
});

export default function ContactPage() {
  const schema = buildWebPageSchema({
    path: "/contact",
    name: "Contact BuyWhere",
    description:
      "Get in touch with the BuyWhere team. We respond to merchant and partner inquiries within one business day.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Contact", path: "/contact" },
    ],
  });
  return (
    <>
      <Schema data={schema} />
      <div className="flex flex-col min-h-screen">
      <Nav />

      <main id="main-content" tabIndex={-1}>
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

            <div id="contact-form">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Send us a message</h2>
              <ContactForm />
            </div>

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
                    <a href="#contact-form" className="hover:text-indigo-600 hover:underline">Use the form on this page</a>
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

      </main>
      <Footer />
    </div>
  </>
  );
}
