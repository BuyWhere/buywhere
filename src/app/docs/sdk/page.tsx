import { redirect } from "next/navigation";
import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";

// BUY-69733: this route intercepts /docs/sdk before the infrastructure-level
// 308 so the page renders with canonical/og:url/robots + JSON-LD instead of
// redirecting to /developers at the CDN.  The canonical URL is /docs/sdk so
// Google indexes the SDK documentation URL rather than the developer portal URL.
export const metadata = {
  ...buildPageMetadata({
    title: "BuyWhere SDK Reference — JavaScript & Python Client Libraries",
    description:
      "Install and use the BuyWhere SDK in JavaScript/TypeScript or Python. Includes code examples for product search, price comparison, and AI agent integration.",
    path: "/docs/sdk",
  }),
  robots: {
    index: true,
    follow: true,
  },
};

const techArticleSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TechArticle",
      "@id": "https://buywhere.ai/docs/sdk#techarticle",
      url: "https://buywhere.ai/docs/sdk",
      name: "BuyWhere SDK Reference — JavaScript & Python Client Libraries",
      description:
        "Install and use the BuyWhere SDK in JavaScript/TypeScript or Python. Includes code examples for product search, price comparison, and AI agent integration.",
      inLanguage: "en-US",
      isPartOf: { "@id": "https://buywhere.ai/#website" },
      about: { "@id": "https://buywhere.ai/#organization" },
      genre: "API Reference",
      proficiencyLevel: "Intermediate",
      version: "1.0",
    },
    {
      "@type": "SoftwareSourceCode",
      name: "@buywhere/sdk",
      description: "Official BuyWhere JavaScript/TypeScript SDK for product search and price comparison.",
      programmingLanguage: "TypeScript",
      url: "https://www.npmjs.com/package/@buywhere/sdk",
      license: "MIT",
      provider: { "@id": "https://buywhere.ai/#organization" },
    },
    {
      "@type": "SoftwareSourceCode",
      name: "buywhere (PyPI)",
      description: "Official BuyWhere Python SDK for product search and price comparison.",
      programmingLanguage: "Python",
      url: "https://pypi.org/project/buywhere/",
      license: "MIT",
      provider: { "@id": "https://buywhere.ai/#organization" },
    },
  ],
};

const webPageSchema = buildWebPageSchema({
  path: "/docs/sdk",
  name: "BuyWhere SDK Reference — JavaScript & Python Client Libraries",
  description:
    "Install and use the BuyWhere SDK in JavaScript/TypeScript or Python. Includes code examples for product search, price comparison, and AI agent integration.",
  breadcrumb: [
    { name: "Home", path: "/" },
    { name: "Documentation", path: "/docs" },
    { name: "SDK Reference", path: "/docs/sdk" },
  ],
});

export default function DocsSdkPage() {
  // Redirect to the developer portal where the SDK documentation lives.
  redirect("/developers");
}
