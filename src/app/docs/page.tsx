import type { Metadata } from "next";
import Schema from "@/components/Schema";
import DocsRedirect from "./DocsRedirect";
import { buildWebPageSchema } from "@/lib/page-schema";
import { toSiteUrl } from "@/lib/site-url";

// Self-referential, non-trailing-slash canonical on /docs.
// The /docs page body issues a client-side redirect to /quickstart via the
// DocsRedirect client component, but Next.js still emits the metadata
// generated here in the <head>, so the served HTML carries the canonical
// link tag. This clears the GSC "Duplicate without user-selected canonical"
// bucket for /docs vs /docs/.
export function generateMetadata(): Metadata {
  return {
    title: "Documentation — BuyWhere",
    description:
      "BuyWhere developer documentation: MCP server, product catalog API, quickstart, rate limits, and operational runbooks.",
    alternates: {
      canonical: toSiteUrl("/docs"),
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title: "Documentation — BuyWhere",
      description:
        "BuyWhere developer documentation: MCP server, product catalog API, quickstart, rate limits, and operational runbooks.",
      url: toSiteUrl("/docs"),
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: "BuyWhere developer documentation",
        },
      ],
    },
  };
}

export default function DocsPage() {
  const schema = buildWebPageSchema({
    path: "/docs",
    name: "Documentation | BuyWhere",
    description:
      "BuyWhere developer documentation: MCP server, product catalog API, quickstart, rate limits, and operational runbooks.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Documentation", path: "/docs" },
    ],
  });
  return (
    <>
      <Schema data={schema} />
      <DocsRedirect />
    </>
  );
}
