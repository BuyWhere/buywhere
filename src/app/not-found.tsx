import type { Metadata } from "next";
import NotFoundClient from "@/app/NotFoundClient";

// 404 metadata: generic, noindex. Next.js shallow-merges metadata down the
// segment tree, and not-found.tsx is rendered for unmatched routes (e.g. the
// Stripe portal/webhook aliases) — we override the homepage shell title/OG
// here and also emit inline head tags below so HTML-limited bots and auditors
// that do not execute the metadata pipeline still see the generic 404 labels.
export const metadata: Metadata = {
  title: "Page not found (404) — BuyWhere",
  description:
    "The BuyWhere page you are looking for could not be found. Search 288M+ products, browse categories, or return to the homepage.",
  openGraph: {
    title: "Page not found (404) — BuyWhere",
    description:
      "The BuyWhere page you are looking for could not be found. Search 288M+ products, browse categories, or return to the homepage.",
    type: "website",
    siteName: "BuyWhere",
  },
  twitter: {
    card: "summary_large_image",
    title: "Page not found (404) — BuyWhere",
    description:
      "The BuyWhere page you are looking for could not be found. Search 288M+ products, browse categories, or return to the homepage.",
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function NotFound() {
  return (
    <>
      {/* Inline head tags: belt-and-suspenders override of the root-layout
          homepage title/OG for HTML-limited bots and metadata auditors that
          do not resolve the Next.js metadata pipeline for not-found routes. */}
      <title>Page not found (404) — BuyWhere</title>
      <meta
        name="description"
        content="The BuyWhere page you are looking for could not be found. Search 288M+ products, browse categories, or return to the homepage."
      />
      <meta name="robots" content="noindex, follow" />
      <meta property="og:title" content="Page not found (404) — BuyWhere" />
      <meta
        property="og:description"
        content="The BuyWhere page you are looking for could not be found. Search 288M+ products, browse categories, or return to the homepage."
      />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="BuyWhere" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="Page not found (404) — BuyWhere" />
      <NotFoundClient />
    </>
  );
}
