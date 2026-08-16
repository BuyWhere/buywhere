import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Invite Friends — BuyWhere",
  description: "Invite friends and colleagues to BuyWhere. Earn referral credit when they sign up for a paid plan.",
  alternates: {
    canonical: toSiteUrl("/invite/"),
  },
};

export default function InvitePage() {
  return (
    <div className="flex flex-col min-h-screen">
      <Nav />

      <main id="main-content" className="flex-1 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Invite Friends</h1>
          <p className="text-sm text-gray-400 mb-10">Share BuyWhere with your network and earn rewards</p>

          <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">How It Works</h2>
              <p>
                Invite friends and colleagues to try BuyWhere. When your invitees sign up for a paid plan,
                you earn account credit that applies toward your subscription.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Share Your Invite Link</h2>
              <p>
                Sign in to your BuyWhere account and visit the dashboard to find your personal invite link.
                Share it via email, Slack, or any channel you prefer.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Reward Details</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li>Credit is awarded after the invited user completes their first paid plan charge</li>
                <li>Credits have no expiration date</li>
                <li>Referral abuse or self-referrals are not permitted</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">Need Help?</h2>
              <p>
                Reach out to{" "}
                <a href="mailto:support@buywhere.ai" className="text-indigo-600 hover:underline">
                  support@buywhere.ai
                </a>{" "}
                with any questions about the invite program.
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
