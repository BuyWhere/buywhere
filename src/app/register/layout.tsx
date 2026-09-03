import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create BuyWhere Developer Account",
  description: "Create your free BuyWhere developer account and get instant API access. No credit card required - start building in minutes with 10,000 requests/day.",
  alternates: {
    canonical: "/register",
  },
  openGraph: {
    title: "Create BuyWhere Developer Account",
    description: "Create your free BuyWhere developer account and get instant API access. No credit card required - start building in minutes with 10,000 requests/day.",
    url: "https://buywhere.ai/register",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Create BuyWhere Developer Account",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Create BuyWhere Developer Account",
    description: "Create your free BuyWhere developer account and get instant API access. No credit card required - start building in minutes with 10,000 requests/day.",
    images: ["/og-image.png"],
  },
  robots: {
    index: false,
    follow: true,
  },
};

// BUY-57869: registration utility page is low-value for search; noindex but allow
// crawlers to follow links off-page so internal pages still get discovered.


export default function RegisterLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}