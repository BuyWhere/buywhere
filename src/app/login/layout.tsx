import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/page-metadata";

// buildPageMetadata emits title + description + canonical + og:image + twitter:image
// (defaulting to /og-image.png). Previously this layout hand-wrote metadata with no
// og:image / twitter:image. BUY-68919 AC #4.
export const metadata: Metadata = {
  ...buildPageMetadata({
    title: "Sign in to BuyWhere Developer Dashboard",
    description:
      "Sign in to your BuyWhere developer dashboard using your API key to manage API keys, view usage statistics, and access documentation.",
    path: "/login",
  }),
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
