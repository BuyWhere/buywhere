import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";

export const metadata: Metadata = {
  title: "Accessibility Statement — BuyWhere",
  description:
    "BuyWhere is committed to ensuring digital accessibility for people with disabilities. We are continually improving the user experience for everyone.",
  alternates: {
    canonical: "https://buywhere.ai/accessibility",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Accessibility Statement — BuyWhere",
    description:
      "BuyWhere is committed to ensuring digital accessibility for people with disabilities.",
    url: "https://buywhere.ai/accessibility",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "BuyWhere Accessibility Statement",
      },
    ],
  },
};

export default function AccessibilityPage() {
  const schema = buildWebPageSchema({
    path: "/accessibility",
    name: "Accessibility Statement | BuyWhere",
    description:
      "BuyWhere is committed to ensuring digital accessibility for people with disabilities.",
  });

  return (
    <>
      <Schema data={schema} />
      <Nav />
      <main id="main-content" className="flex-1 py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">
            Accessibility Statement
          </h1>
          <div className="mt-8 prose prose-slate max-w-none">
            <p className="text-lg leading-relaxed text-slate-600">
              BuyWhere is committed to ensuring digital accessibility for people with
              disabilities. We are continually improving the user experience for everyone,
              and apply the relevant accessibility standards to guarantee we provide equal
              access to all users.
            </p>

            <h2 className="mt-10 text-2xl font-semibold text-slate-900">
              Our Commitment
            </h2>
            <p className="mt-4 text-slate-600">
              We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.1
              Level AA. These guidelines explain how to make web content more accessible
              for people with disabilities and more user-friendly for everyone.
            </p>

            <h2 className="mt-10 text-2xl font-semibold text-slate-900">
              Supported Assistive Technologies
            </h2>
            <p className="mt-4 text-slate-600">
              Our website is designed to work with screen readers, voice recognition
              software, and other assistive technologies. We test with major screen
              readers including NVDA, JAWS, and VoiceOver.
            </p>

            <h2 className="mt-10 text-2xl font-semibold text-slate-900">
              Accessibility Features
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-600">
              <li>Semantic HTML for proper document structure</li>
              <li>Keyboard navigation for all interactive elements</li>
              <li>Skip links to bypass navigation and jump to main content</li>
              <li>Alt text for all meaningful images</li>
              <li>Color contrast ratios meeting WCAG AA standards</li>
              <li>Focus indicators on all interactive elements</li>
              <li>Resizable text without loss of functionality</li>
            </ul>

            <h2 className="mt-10 text-2xl font-semibold text-slate-900">
              Feedback and Contact
            </h2>
            <p className="mt-4 text-slate-600">
              We welcome your feedback on the accessibility of BuyWhere. Please let us
              know if you encounter accessibility barriers:
            </p>
            <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-600">
              <li>Email: accessibility@buywhere.ai</li>
              <li>Through our contact form at /contact</li>
            </ul>

            <p className="mt-8 text-slate-600">
              We will respond to feedback within 3 business days.
            </p>

            <h2 className="mt-10 text-2xl font-semibold text-slate-900">
              Limitations and Alternatives
            </h2>
            <p className="mt-4 text-slate-600">
              Despite our best efforts to ensure accessibility, there may be some
              limitations. Below is a description of known limitations:
            </p>
            <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-600">
              <li>
                Some older PDF documents may not be fully accessible. We are working
                to remediate these.
              </li>
            </ul>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
