import type { Metadata } from "next";
import Schema from "@/components/Schema";
import DocsRedirect from "./DocsRedirect";
import { buildPageMetadata } from "@/lib/page-metadata";
import { buildWebPageSchema } from "@/lib/page-schema";

// Self-referential, non-trailing-slash canonical on /docs.
// The /docs page body issues a client-side redirect to /quickstart via the
// DocsRedirect client component, but Next.js still emits the metadata
// generated here in the <head>, so the served HTML carries the canonical
// link tag. This clears the GSC "Duplicate without user-selected canonical"
// bucket for /docs vs /docs/.
const DOCS_TITLE = "Documentation — BuyWhere";
const DOCS_DESCRIPTION =
  "BuyWhere developer documentation: MCP server, product catalog API, quickstart, rate limits, and operational runbooks.";
const DOCS_PATH = "/docs";

export function generateMetadata(): Metadata {
  return {
    ...buildPageMetadata({
      title: DOCS_TITLE,
      description: DOCS_DESCRIPTION,
      path: DOCS_PATH,
    }),
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default function DocsPage() {
  const schema = buildWebPageSchema({
    path: DOCS_PATH,
    name: DOCS_TITLE,
    description: DOCS_DESCRIPTION,
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
