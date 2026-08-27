import type { Metadata } from "next";
import { toSiteUrl } from "@/lib/site-url";
import CheckoutClient from "./CheckoutClient";

const CHECKOUT_DESCRIPTION =
  "Confirm your BuyWhere Pro or Scale plan, then continue to Stripe checkout with the developer account tied to your API key.";

// Checkout is inherently per-session (CheckoutClient reads useSearchParams). It was only ever
// rendered on demand because the old root layout read headers(); now that the layout is static
// again, declare it dynamic explicitly so the build does not try to prerender it.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "Stripe Checkout | BuyWhere",
  description: CHECKOUT_DESCRIPTION,
  alternates: {
    canonical: toSiteUrl("/checkout"),
  },
  robots: {
    index: false,
    follow: true,
  },
  openGraph: {
    title: "Stripe Checkout | BuyWhere",
    description: CHECKOUT_DESCRIPTION,
    url: toSiteUrl("/checkout"),
    type: "website",
    siteName: "BuyWhere",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "BuyWhere Stripe Checkout",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stripe Checkout | BuyWhere",
    description: CHECKOUT_DESCRIPTION,
    images: ["/og-image.png"],
  },
};

export default function CheckoutPage() {
  return <CheckoutClient />;
}
