import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Unmapped /auth/* paths (e.g. /auth/callback, /auth/return, /auth/verify,
// /auth/signin) previously fell through to the root not-found.tsx, which is a
// client component and so inherited the homepage <title>. This catch-all shell
// emits a route-specific title/metadata (no homepage inheritance) and then
// intentionally 404s via notFound(), matching the BUY-68979 sub-route shell
// pattern. BUY-68919 AC #3.

type Params = Promise<{ path: string[] }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { path } = await params;
  const joined = path.join("/");
  return {
    title: `Page Not Found: /auth/${joined} — BuyWhere`,
    description:
      "The requested /auth route is not available. Sign in to the BuyWhere developer dashboard at /login, or return to the homepage.",
    robots: { index: false, follow: true },
  };
}

export default async function UnsupportedAuthPage({ params }: { params: Params }) {
  await params;
  notFound();
}
