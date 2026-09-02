import { buildPageMetadata } from "@/lib/page-metadata";
export const metadata = buildPageMetadata({
  title: "Get BuyWhere API Key - Free Developer Access | BuyWhere",
  description:
    "Get a BuyWhere API key for live product discovery, comparison, and merchant handoff across the US and Southeast Asia.",
  path: "/api-keys/",
});

export default function ApiKeysLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
