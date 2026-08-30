import type { Metadata } from "next";

import { buildPageMetadata } from "@/lib/page-metadata";
import DeveloperSignupClient from "./DeveloperSignupClient";

export const metadata: Metadata = buildPageMetadata({
  title: "Developer Signup — Get a Free BuyWhere API Key | BuyWhere",
  description:
    "Create a BuyWhere developer account and get a free API key for real-time product search, price comparison, and merchant handoff APIs.",
  path: "/developers/signup",
});

const developerSignupJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Developer Signup — Get a Free BuyWhere API Key",
  description:
    "Create a BuyWhere developer account and get a free API key for real-time product search, price comparison, and merchant handoff APIs.",
  url: "https://buywhere.ai/developers/signup",
  isPartOf: {
    "@type": "WebSite",
    name: "BuyWhere",
    url: "https://buywhere.ai",
  },
  publisher: {
    "@type": "Organization",
    name: "BuyWhere",
    url: "https://buywhere.ai",
  },
  potentialAction: {
    "@type": "RegisterAction",
    target: "https://buywhere.ai/developers/signup",
    name: "Create a BuyWhere developer account",
  },
};

export default function DeveloperSignupPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(developerSignupJsonLd) }}
      />
      <DeveloperSignupClient />
    </>
  );
}
