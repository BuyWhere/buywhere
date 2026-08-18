import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout Cancelled — BuyWhere Developer Dashboard",
  description:
    "Stripe checkout was cancelled before payment completed. Your BuyWhere developer account stays on its current plan.",
  alternates: {
    canonical: "https://buywhere.ai/checkout/cancel",
  },
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: "Checkout Cancelled — BuyWhere Developer Dashboard",
    description:
      "Stripe checkout was cancelled before payment completed. Your BuyWhere developer account stays on its current plan.",
    url: "https://buywhere.ai/checkout/cancel",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "BuyWhere Checkout Cancelled",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Checkout Cancelled — BuyWhere Developer Dashboard",
    description:
      "Stripe checkout was cancelled before payment completed. Your BuyWhere developer account stays on its current plan.",
    images: ["/og-image.png"],
  },
};

export default function CheckoutCancelLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
