import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in to BuyWhere Developer Dashboard",
  description: "Sign in to your BuyWhere developer dashboard using your API key to manage API keys, view usage statistics, and access documentation.",
  alternates: {
    canonical: "/login",
  },
  openGraph: {
    title: "Sign in to BuyWhere Developer Dashboard",
    description: "Sign in to your BuyWhere developer dashboard using your API key to manage API keys, view usage statistics, and access documentation.",
    url: "https://buywhere.ai/login",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sign in to BuyWhere Developer Dashboard",
    description: "Sign in to your BuyWhere developer dashboard using your API key to manage API keys, view usage statistics, and access documentation.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function LoginLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
