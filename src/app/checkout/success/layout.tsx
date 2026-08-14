import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout Successful — BuyWhere Developer Dashboard",
  description: "Your BuyWhere subscription has been activated successfully. View your plan details and manage your developer account.",
  openGraph: {
    title: "Checkout Successful — BuyWhere Developer Dashboard",
    description: "Your BuyWhere subscription has been activated successfully. View your plan details and manage your developer account.",
    url: "https://buywhere.ai/checkout/success",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "BuyWhere Checkout Successful",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Checkout Successful — BuyWhere Developer Dashboard",
    description: "Your BuyWhere subscription has been activated successfully. View your plan details and manage your developer account.",
    images: ["/og-image.png"],
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function CheckoutSuccessLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}