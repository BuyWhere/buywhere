import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { HowItWorksSection } from "@/components/HowItWorksSection";
import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "How It Works — BuyWhere AI Product Catalog",
  description:
    "See how BuyWhere connects AI agents to product data across 950,000+ merchants — from natural language query to purchase-ready results.",
  path: "/how-it-works/",
});

export default function HowItWorksPage() {
  const schema = buildWebPageSchema({
    path: "/how-it-works",
    name: "How It Works — BuyWhere AI Product Catalog",
    description:
      "See how BuyWhere connects AI agents to product data across 950,000+ merchants.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "How It Works", path: "/how-it-works" },
    ],
  });

  return (
    <>
      <Schema data={schema} />
      <div className="flex min-h-screen flex-col">
        <Nav />
        <main className="flex-1">
          <HowItWorksSection />
        </main>
        <Footer />
      </div>
    </>
  );
}
