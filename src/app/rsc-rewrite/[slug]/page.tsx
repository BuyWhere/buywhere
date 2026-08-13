import type { Metadata } from "next";

// BUY-69260: minimal route handler for middleware-rewritten RSC requests.
// The middleware (src/middleware.ts) detects Chrome's RSC navigation against
// /search or /compare carrying a populated `Next-Router-State-Tree` header
// and rewrites the request to /_rsc/search or /_rsc/compare.  This route
// returns a 200 with an empty RSC payload, so the Chrome client receives a
// successful response and falls back to URL-derived state. The actual
// visible page (the user's URL bar still shows /search?... or /compare?...)
// is unaffected — middleware rewrites are server-internal only.
//
// Why this works: Next 14.2.35's router-state parser is what crashes on the
// populated __PAGE__ shape; bypassing the parser via a clean rewrite path
// is the only reliable fix that does not require a Next.js upgrade.
//
// This page is intentionally minimal — it never renders visible content.
// All real rendering happens on the original /search or /compare route
// after the client receives the empty RSC payload.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: slug === "search" ? "Search — BuyWhere" : "Compare — BuyWhere",
    robots: { index: false, follow: false },
  };
}

export default async function RscRewritePage({ params, searchParams }: Props) {
  // Read params eagerly to surface any throw in a deterministic order — this
  // intentionally swallows the router-state crash so Chrome sees a 200.
  let _: string | undefined;
  let __: Record<string, string | string[] | undefined> | undefined;
  try {
    const { slug: s } = await params;
    _ = s;
    __ = searchParams ? await searchParams : undefined;
  } catch {
    _ = undefined;
    __ = undefined;
  }

  return null;
}
