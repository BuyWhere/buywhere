import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Schema from "@/components/Schema";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";
import { buildWebPageSchema } from "@/lib/page-schema";

export const metadata: Metadata = {
  title: "Cookie Policy — BuyWhere",
  description: "BuyWhere Cookie Policy",
  alternates: {
    canonical: toSiteUrl("/cookie/"),
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Cookie Policy — BuyWhere",
    description: "BuyWhere Cookie Policy",
    url: toSiteUrl("/cookie/"),
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "BuyWhere Cookie Policy",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Cookie Policy — BuyWhere",
    description: "BuyWhere Cookie Policy",
    images: ["/og-image.png"],
  },
};

const cookieSchema = buildWebPageSchema({
  path: "/cookie/",
  name: "Cookie Policy",
  description: "BuyWhere Cookie Policy",
});

export default function CookiePage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Schema data={cookieSchema} />
      <Nav />

      <main id="main-content" className="flex-1 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Cookie Policy</h1>
          <p className="text-sm text-gray-400 mb-10">Last updated: 1 April 2026</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">1. What Are Cookies</h2>
              <p>
                Cookies are small text files stored on your device when you visit a website. They help
                websites remember your preferences and improve your browsing experience. This Cookie
                Policy explains how BuyWhere uses cookies on buywhere.ai and associated services.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Types of Cookies We Use</h2>
              <p>We use the following categories of cookies:</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>
                  <strong>Essential cookies:</strong> Required for authentication, session management,
                  and core functionality. These cannot be disabled without affecting service operation.
                </li>
                <li>
                  <strong>Analytics cookies:</strong> Help us understand how visitors interact with
                  our website so we can improve user experience. These are optional.
                </li>
                <li>
                  <strong>Functional cookies:</strong> Remember your preferences such as language and
                  region settings.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Third-Party Cookies</h2>
              <p>
                Some cookies are placed by third-party services we use, including analytics providers.
                We do not use third-party advertising or tracking cookies. Third-party cookie practices
                are governed by the respective third party&apos;s privacy policy.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Managing Cookies</h2>
              <p>
                Most web browsers allow you to control cookies through their settings. You can block
                cookies, delete existing cookies, or set your browser to notify you when a cookie is
                being set. Note that blocking essential cookies may impair the functionality of our
                website and API developer portal.
              </p>
              <p className="mt-2">
                For more information on managing cookies, visit{" "}
                <a
                  href="https://www.aboutcookies.org"
                  className="text-indigo-600 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  aboutcookies.org
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Updates to This Policy</h2>
              <p>
                We may update this Cookie Policy from time to time. Any changes will be posted on this
                page with an updated &quot;Last updated&quot; date.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Contact Us</h2>
              <p>
                For questions about our use of cookies, contact us via our{" "}
                <a href="/contact" className="text-indigo-600 hover:underline">
                  contact page
                </a>
                .
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
