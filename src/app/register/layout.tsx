import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create BuyWhere Developer Account",
  description: "Create your free BuyWhere developer account and get instant API access. No credit card required - start building in minutes with 1,000 requests/day.",
  alternates: {
    canonical: "/register",
  },
  openGraph: {
    title: "Create BuyWhere Developer Account",
    description: "Create your free BuyWhere developer account and get instant API access. No credit card required - start building in minutes with 1,000 requests/day.",
    url: "https://buywhere.ai/register",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Create BuyWhere Developer Account",
    description: "Create your free BuyWhere developer account and get instant API access. No credit card required - start building in minutes with 1,000 requests/day.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RegisterLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}