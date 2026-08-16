import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Referral Program — BuyWhere",
  description: "Earn rewards by referring developers and teams to BuyWhere. Get credit for every paid plan sign-up through your referral link.",
  alternates: {
    canonical: toSiteUrl("/referral/"),
  },
};

export default function ReferralPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      <main id="main-content" className="flex-1 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Referral Program</h1>
          <p className="text-sm text-gray-400 mb-10">Earn rewards by sharing BuyWhere with your network</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">How It Works</h2>
              <p>
                Share BuyWhere with developers, product teams, or anyone building AI-powered commerce
                applications. When someone signs up for a paid plan using your referral link, you earn
                account credit toward your own subscription.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Program Terms</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li>Credit is applied to your BuyWhere account after the referred user&apos;s first paid charge</li>
                <li>Standard referral credit does not expire</li>
                <li>Abuse, self-referrals, or fraudulent referrals will result in account termination</li>
                <li>Program terms are subject to change with 30 days&apos; notice</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Get Your Referral Link</h2>
              <p>
                Your referral link is available in the{" "}
                <a href="/dashboard" className="text-indigo-600 hover:underline">dashboard</a>{" "}
                once you have a BuyWhere account. Share it with anyone who might benefit from
                our product catalog API.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Questions</h2>
              <p>
                Contact{" "}
                <a href="mailto:support@buywhere.ai" className="text-indigo-600 hover:underline">
                  support@buywhere.ai
                </a>{" "}
                for questions about the referral program.
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
