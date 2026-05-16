import type { Metadata } from "next";
import RootLayout from "../layout";

export const metadata: Metadata = {
  title: "Get BuyWhere API Key - Free Developer Access | BuyWhere",
  description:
    "Get a BuyWhere API key for live product discovery, comparison, and merchant handoff across the US and Southeast Asia.",
  alternates: {
    canonical: "https://buywhere.ai/api-keys/",
  },
};

export default function ApiKeysLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RootLayout>{children}</RootLayout>;
}
