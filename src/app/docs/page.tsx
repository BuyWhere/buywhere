import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";
import { toSiteUrl } from "@/lib/site-url";

// Self-referential, non-trailing-slash canonical on /docs.
// The /docs page body issues a client-side redirect to /quickstart via
// redirect("/quickstart") below, but Next.js still emits the metadata
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
  // Render the schema first so the JSON-LD is in the SSR HTML response,
  // then issue the server-side redirect to /quickstart. redirect() throws
  // NEXT_REDIRECT which Next.js catches at the framework boundary, so the
  // JSX above is what the client sees on the way to the redirect.
  return (
    <>
      <Schema data={schema} />
      {redirect("/quickstart")}
    </>
  );
}
